import type { CreateFolderArchiveResult, FolderArchiver } from './folder-archiver.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';
import type { FolderDownload } from './folder-download.js';

const LEASE_DURATION_MS = 15 * 60 * 1000;
const ARCHIVE_RETENTION_MS = 60 * 60 * 1000;
const ARCHIVE_FAILURE_CODE = 'archive_creation_failed';

export class FolderDownloadProcessor {
  constructor(
    private readonly repository: FolderDownloadRepository,
    private readonly archiver: FolderArchiver,
  ) {}

  async processNext(): Promise<boolean> {
    const claimedAt = new Date();

    const download = await this.repository.claimNext({
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + LEASE_DURATION_MS),
    });

    if (!download) {
      return false;
    }

    await this.processClaimedDownload(download);
    return true;
  }

  private async processClaimedDownload(download: FolderDownload): Promise<void> {
    const archiveObjectKey = `${download.archiveObjectKey}/${download.attemptCount}.zip`;
    const entries = await this.repository.getArchiveManifest({
      ownerId: download.ownerId,
      rootFolderId: download.folderId,
      rootFolderName: download.folderName,
    });

    let archiveResult: CreateFolderArchiveResult;

    try {
      archiveResult = await this.archiver.create({ entries, archiveObjectKey });
    } catch (error) {
      await this.markFailed(download, error);
      return;
    }

    const finishedAt = new Date();

    const outcome = await this.repository.completeArchiveAttempt({
      id: download.id,
      attemptCount: download.attemptCount,
      archiveObjectKey,
      archiveSizeBytes: archiveResult.sizeBytes,
      finishedAt,
      expiresAt: new Date(finishedAt.getTime() + ARCHIVE_RETENTION_MS),
    });

    if (outcome === 'stale') {
      console.warn('Folder download attempt is no longer active', {
        downloadId: download.downloadId,
        attemptCount: download.attemptCount,
        archiveObjectKey,
      });
    }
  }

  private async markFailed(download: FolderDownload, error: unknown): Promise<void> {
    const markedFailed = await this.repository.markFailed({
      id: download.id,
      attemptCount: download.attemptCount,
      failureCode: ARCHIVE_FAILURE_CODE,
      finishedAt: new Date(),
    });

    console.error('Folder download processing failed', {
      downloadId: download.downloadId,
      attemptCount: download.attemptCount,
      markedFailed,
      error,
    });
  }
}
