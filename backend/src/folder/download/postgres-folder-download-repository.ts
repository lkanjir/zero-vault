import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/db-client.js';
import { entries, folderDownloads } from '../../db/schema.js';
import type {
  ClaimNextFolderDownloadCommand,
  CompleteFolderDownloadAttemptCommand,
  CreateFolderDownloadCommand,
  ExpireReadyFolderDownloadsCommand,
  FolderDownloadRepository,
  GetFolderArchiveManifestCommand,
  MarkFolderDownloadFailedCommand,
  RenewFolderDownloadLeaseCommand,
} from './folder-download-repository.js';
import type { FolderArchiveEntry, FolderDownload } from './folder-download.js';
import { AppError } from '../../shared/errors/api/app-error.js';
import {
  enqueueObjectDeletionInTransaction,
  enqueueObjectDeletionsInTransaction,
} from '../../object-deletion/object-deletion-helpers.js';

type FolderArchiveManifestRow = {
  kind: 'folder' | 'file';
  pathParts: string[];
  objectKey: string | null;
  sizeBytes: string | null;
};

export class PostgresFolderDownloadRepository implements FolderDownloadRepository {
  async create(command: CreateFolderDownloadCommand): Promise<FolderDownload> {
    return db.transaction(async (tx) => {
      const [folder] = await tx
        .select({ id: entries.id, name: entries.name })
        .from(entries)
        .where(
          and(
            eq(entries.publicId, command.folderPublicId),
            eq(entries.ownerId, command.ownerId),
            eq(entries.kind, 'folder'),
            isNull(entries.deletedAt),
          ),
        )
        .limit(1);

      if (!folder) {
        throw new AppError('folder_not_found');
      }

      const [download] = await tx
        .insert(folderDownloads)
        .values({
          downloadId: command.downloadId,
          ownerId: command.ownerId,
          folderId: folder.id,
          folderName: folder.name,
          archiveObjectKey: command.archiveObjectKey,
          status: 'queued',
          createdAt: command.createdAt,
        })
        .returning();

      if (!download) {
        throw new Error('Failed to create folder download');
      }

      return this.toDomain(download);
    });
  }

  async findByOwnerAndDownloadId(
    ownerId: number,
    downloadId: string,
  ): Promise<FolderDownload | null> {
    const [row] = await db
      .select()
      .from(folderDownloads)
      .where(and(eq(folderDownloads.downloadId, downloadId), eq(folderDownloads.ownerId, ownerId)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async claimNext(command: ClaimNextFolderDownloadCommand): Promise<FolderDownload | null> {
    return db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: folderDownloads.id })
        .from(folderDownloads)
        .where(
          or(
            eq(folderDownloads.status, 'queued'),
            and(
              eq(folderDownloads.status, 'processing'),
              or(
                isNull(folderDownloads.leaseExpiresAt),
                lte(folderDownloads.leaseExpiresAt, command.claimedAt),
              ),
            ),
          ),
        )
        .orderBy(folderDownloads.createdAt, folderDownloads.id)
        .for('update', { skipLocked: true })
        .limit(1);

      if (!candidate) {
        return null;
      }

      const [claimed] = await tx
        .update(folderDownloads)
        .set({
          status: 'processing',
          startedAt: command.claimedAt,
          leaseExpiresAt: command.leaseExpiresAt,
          attemptCount: sql`${folderDownloads.attemptCount} + 1`,
          failureCode: null,
        })
        .where(eq(folderDownloads.id, candidate.id))
        .returning();

      if (!claimed) {
        throw new Error('Failed to claim folder');
      }

      return this.toDomain(claimed);
    });
  }

  async renewLease(command: RenewFolderDownloadLeaseCommand): Promise<boolean> {
    const [updated] = await db
      .update(folderDownloads)
      .set({ leaseExpiresAt: command.leaseExpiresAt })
      .where(this.activeAttemptCondition(command.id, command.attemptCount))
      .returning({ id: folderDownloads.id });

    return updated !== undefined;
  }

  async completeArchiveAttempt(
    command: CompleteFolderDownloadAttemptCommand,
  ): Promise<'ready' | 'stale'> {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(folderDownloads)
        .set({
          status: 'ready',
          archiveObjectKey: command.archiveObjectKey,
          archiveSizeBytes: command.archiveSizeBytes,
          finishedAt: command.finishedAt,
          expiresAt: command.expiresAt,
          leaseExpiresAt: null,
          failureCode: null,
        })
        .where(this.activeAttemptCondition(command.id, command.attemptCount))
        .returning({ id: folderDownloads.id });

      if (updated) {
        return 'ready';
      }

      const [current] = await tx
        .select({
          status: folderDownloads.status,
          attemptCount: folderDownloads.attemptCount,
          archiveObjectKey: folderDownloads.archiveObjectKey,
        })
        .from(folderDownloads)
        .where(eq(folderDownloads.id, command.id))
        .for('update')
        .limit(1);

      const alreadyCompleted =
        current?.status === 'ready' &&
        current.attemptCount === command.attemptCount &&
        current.archiveObjectKey === command.archiveObjectKey;

      if (alreadyCompleted) {
        return 'ready';
      }

      await enqueueObjectDeletionInTransaction(tx, {
        objectKey: command.archiveObjectKey,
        reason: 'stale_folder_archive_attempt',
      });

      return 'stale';
    });
  }

  async markFailed(command: MarkFolderDownloadFailedCommand): Promise<boolean> {
    const [updated] = await db
      .update(folderDownloads)
      .set({
        status: 'failed',
        failureCode: command.failureCode,
        finishedAt: command.finishedAt,
        leaseExpiresAt: null,
        archiveSizeBytes: null,
        expiresAt: null,
      })
      .where(this.activeAttemptCondition(command.id, command.attemptCount))
      .returning({ id: folderDownloads.id });

    return updated !== undefined;
  }

  async getArchiveManifest(
    command: GetFolderArchiveManifestCommand,
  ): Promise<FolderArchiveEntry[]> {
    const result = await db.execute<FolderArchiveManifestRow>(sql`
      WITH RECURSIVE folder_tree AS (
        SELECT
          root.id,
          root.kind,
          ARRAY[${command.rootFolderName}]::text[] AS path_parts,
          ARRAY[root.id]::bigint[] AS visited_ids
        FROM entries root
        WHERE root.id = ${command.rootFolderId}
          AND root.owner_id = ${command.ownerId}
          AND root.kind = 'folder'
          AND root.deleted_at IS NULL

        UNION ALL

        SELECT
          child.id,
          child.kind,
          parent.path_parts || ARRAY[child.name]::text[],
          parent.visited_ids || ARRAY[child.id]::bigint[]
        FROM entries child
        JOIN folder_tree parent
          ON child.parent_id = parent.id
          AND parent.kind = 'folder'
        WHERE child.owner_id = ${command.ownerId}
          AND child.deleted_at IS NULL
          AND NOT (child.id = ANY(parent.visited_ids))
      )
      SELECT
        tree.kind,
        tree.path_parts AS "pathParts",
        file.object_key as "objectKey",
        file.size_bytes::text as "sizeBytes"
      FROM folder_tree tree
      LEFT JOIN files file
        ON file.entry_id = tree.id
      ORDER BY tree.path_parts, tree.id
      `);

    return result.rows.map((row) => {
      if (row.kind === 'folder') {
        return {
          kind: 'folder',
          pathParts: row.pathParts,
        };
      }

      if (row.objectKey === null || row.sizeBytes === null) {
        throw new Error('Archive file is missing metadata');
      }

      const sizeBytes = Number(row.sizeBytes);

      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        throw new Error('Archive file has invalid size');
      }

      return {
        kind: 'file',
        pathParts: row.pathParts,
        objectKey: row.objectKey,
        sizeBytes,
      };
    });
  }

  async expireReadyFolderDownloads(command: ExpireReadyFolderDownloadsCommand): Promise<number> {
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: folderDownloads.id })
        .from(folderDownloads)
        .where(
          and(
            eq(folderDownloads.status, 'ready'),
            lte(folderDownloads.expiresAt, command.expiredAt),
          ),
        )
        .orderBy(folderDownloads.expiresAt, folderDownloads.id)
        .for('update', { skipLocked: true })
        .limit(command.limit);

      if (candidates.length === 0) {
        return 0;
      }

      const expired = await tx
        .update(folderDownloads)
        .set({ status: 'expired' })
        .where(
          and(
            inArray(
              folderDownloads.id,
              candidates.map((item) => item.id),
            ),
            eq(folderDownloads.status, 'ready'),
          ),
        )
        .returning({ archiveObjectKey: folderDownloads.archiveObjectKey });

      if (expired.length !== candidates.length) {
        throw new Error('Failed to expire all locked folder downloads');
      }

      await enqueueObjectDeletionsInTransaction(
        tx,
        expired.map((item) => ({
          objectKey: item.archiveObjectKey,
          reason: 'expired_folder_archive',
        })),
      );

      return expired.length;
    });
  }

  private activeAttemptCondition(id: number, attemptCount: number) {
    return and(
      eq(folderDownloads.id, id),
      eq(folderDownloads.status, 'processing'),
      eq(folderDownloads.attemptCount, attemptCount),
    );
  }

  private toDomain(row: typeof folderDownloads.$inferSelect): FolderDownload {
    return {
      id: row.id,
      downloadId: row.downloadId,
      ownerId: row.ownerId,
      folderId: row.folderId,
      folderName: row.folderName,
      archiveObjectKey: row.archiveObjectKey,
      status: row.status,
      attemptCount: row.attemptCount,
      archiveSizeBytes: row.archiveSizeBytes,
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      leaseExpiresAt: row.leaseExpiresAt,
      expiresAt: row.expiresAt,
    };
  }
}
