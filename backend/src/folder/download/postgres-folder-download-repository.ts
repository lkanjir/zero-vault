import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/db-client.js';
import { entries, folderDownloads } from '../../db/schema.js';
import type {
  ClaimNextFolderDownloadCommand,
  CreateFolderDownloadCommand,
  FolderDownloadRepository,
  MarkFolderDownloadFailedCommand,
  MarkFolderDownloadReadyCommand,
  RenewFolderDownloadLeaseCommand,
} from './folder-download-repository.js';
import type { FolderDownload } from './folder-download.js';
import { AppError } from '../../shared/errors/api/app-error.js';

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

  async markReady(command: MarkFolderDownloadReadyCommand): Promise<boolean> {
    const [updated] = await db
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

    return updated !== undefined;
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
