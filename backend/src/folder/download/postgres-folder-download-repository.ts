import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/db-client.js';
import type { TransactionContext } from '../../db/unit-of-work.js';
import { folderDownloads } from '../../db/schema.js';
import type {
  ClaimNextFolderDownloadCommand,
  CompleteFolderDownloadAttemptCommand,
  CreateFolderDownloadCommand,
  ExpireReadyFolderDownloadsCommand,
  FolderArchiveSummary,
  FolderDownloadRepository,
  GetFolderArchiveManifestCommand,
  GetFolderArchiveSummaryCommand,
  MarkFolderDownloadFailedCommand,
  RenewFolderDownloadLeaseCommand,
} from './folder-download-repository.js';
import type { FolderArchiveEntry, FolderDownload } from './folder-download.js';
import { MAX_FOLDER_TREE_DEPTH } from '../validation-schemas.js';
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

const EXHAUSTED_FAIL_BATCH_SIZE = 100;
const MAX_ATTEMPTS_EXCEEDED_FAILURE_CODE = 'max_attempts_exceeded';

export class PostgresFolderDownloadRepository implements FolderDownloadRepository {
  constructor(private readonly db: Database) {}

  async create(
    command: CreateFolderDownloadCommand,
    tx: TransactionContext,
  ): Promise<FolderDownload> {
    const [download] = await tx
      .insert(folderDownloads)
      .values({
        downloadId: command.downloadId,
        ownerId: command.ownerId,
        folderId: command.folderId,
        folderName: command.folderName,
        archiveObjectKey: command.archiveObjectKey,
        status: 'queued',
        createdAt: command.createdAt,
      })
      .returning();

    if (!download) {
      throw new Error('Failed to create folder download');
    }

    return this.toDomain(download);
  }

  async findByOwnerAndDownloadId(
    ownerId: number,
    downloadId: string,
  ): Promise<FolderDownload | null> {
    const [row] = await this.db
      .select()
      .from(folderDownloads)
      .where(and(eq(folderDownloads.downloadId, downloadId), eq(folderDownloads.ownerId, ownerId)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async claimNext(command: ClaimNextFolderDownloadCommand): Promise<FolderDownload | null> {
    return this.db.transaction(async (tx) => {
      const exhausted = await tx
        .select({ id: folderDownloads.id })
        .from(folderDownloads)
        .where(
          and(
            eq(folderDownloads.status, 'processing'),
            gte(folderDownloads.attemptCount, command.maxAttempts),
            or(
              isNull(folderDownloads.leaseExpiresAt),
              lte(folderDownloads.leaseExpiresAt, command.claimedAt),
            ),
          ),
        )
        .for('update', { skipLocked: true })
        .limit(EXHAUSTED_FAIL_BATCH_SIZE);

      if (exhausted.length > 0) {
        await tx
          .update(folderDownloads)
          .set({
            status: 'failed',
            failureCode: MAX_ATTEMPTS_EXCEEDED_FAILURE_CODE,
            finishedAt: command.claimedAt,
            leaseExpiresAt: null,
            archiveSizeBytes: null,
            expiresAt: null,
          })
          .where(
            and(
              inArray(
                folderDownloads.id,
                exhausted.map((item) => item.id),
              ),
              eq(folderDownloads.status, 'processing'),
            ),
          );
      }

      const [candidate] = await tx
        .select({ id: folderDownloads.id })
        .from(folderDownloads)
        .where(
          and(
            lt(folderDownloads.attemptCount, command.maxAttempts),
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
    const [updated] = await this.db
      .update(folderDownloads)
      .set({ leaseExpiresAt: command.leaseExpiresAt })
      .where(this.activeAttemptCondition(command.id, command.attemptCount))
      .returning({ id: folderDownloads.id });

    return updated !== undefined;
  }

  async completeArchiveAttempt(
    command: CompleteFolderDownloadAttemptCommand,
  ): Promise<'ready' | 'stale'> {
    return this.db.transaction(async (tx) => {
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
    const [updated] = await this.db
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

  async getArchiveSummary(
    command: GetFolderArchiveSummaryCommand,
    tx: TransactionContext,
  ): Promise<FolderArchiveSummary> {
    const result = await tx.execute<{ fileCount: number; totalSizeBytes: string }>(sql`
      WITH RECURSIVE folder_tree AS (
        SELECT
          root.id,
          root.kind,
          1 AS depth,
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
          parent.depth + 1,
          parent.visited_ids || ARRAY[child.id]::bigint[]
        FROM entries child
        JOIN folder_tree parent
          ON child.parent_id = parent.id
          AND parent.kind = 'folder'
        WHERE child.owner_id = ${command.ownerId}
          AND child.deleted_at IS NULL
          AND NOT (child.id = ANY(parent.visited_ids))
          AND (
            (child.kind = 'folder' AND parent.depth < ${MAX_FOLDER_TREE_DEPTH})
            OR (child.kind = 'file' AND parent.depth <= ${MAX_FOLDER_TREE_DEPTH})
          )
      )
      SELECT
        COUNT(file.entry_id)::integer AS "fileCount",
        COALESCE(SUM(file.size_bytes), 0)::text AS "totalSizeBytes"
      FROM folder_tree tree
      JOIN files file
        ON file.entry_id = tree.id
      WHERE tree.kind = 'file'
    `);

    const row = result.rows[0];
    const fileCount = row?.fileCount ?? 0;
    const totalSizeBytes = Number(row?.totalSizeBytes ?? '0');

    if (!Number.isSafeInteger(totalSizeBytes) || totalSizeBytes < 0) {
      throw new Error('Archive summary has invalid total size');
    }

    return {
      fileCount,
      totalSizeBytes,
    };
  }

  async getArchiveManifest(
    command: GetFolderArchiveManifestCommand,
  ): Promise<FolderArchiveEntry[]> {
    const result = await this.db.execute<FolderArchiveManifestRow>(sql`
      WITH RECURSIVE folder_tree AS (
        SELECT
          root.id,
          root.kind,
          1 AS depth,
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
          parent.depth + 1,
          parent.path_parts || ARRAY[child.name]::text[],
          parent.visited_ids || ARRAY[child.id]::bigint[]
        FROM entries child
        JOIN folder_tree parent
          ON child.parent_id = parent.id
          AND parent.kind = 'folder'
        WHERE child.owner_id = ${command.ownerId}
          AND child.deleted_at IS NULL
          AND NOT (child.id = ANY(parent.visited_ids))
          AND (
            (child.kind = 'folder' AND parent.depth < ${MAX_FOLDER_TREE_DEPTH})
            OR (child.kind = 'file' AND parent.depth <= ${MAX_FOLDER_TREE_DEPTH})
          )
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

      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
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
    return this.db.transaction(async (tx) => {
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
