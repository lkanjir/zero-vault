import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/db-client.js';
import { entries, folderDownloads } from '../../db/schema.js';
import type {
  CreateFolderDownloadCommand,
  FolderDownloadRepository,
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
