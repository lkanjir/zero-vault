import {
  DEFAULT_FOLDER_DOWNLOAD_MAX_FILES,
  DEFAULT_FOLDER_DOWNLOAD_MAX_TOTAL_BYTES,
  type FolderDownloadLimitsConfig,
} from '../../config.js';
import type { CreateFolderArchiveResult, FolderArchiver } from './folder-archiver.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';
import type { FolderDownload } from './folder-download.js';

const LEASE_DURATION_MS = 15 * 60 * 1000;
const LEASE_RENEWAL_INTERVAL_MS = LEASE_DURATION_MS / 3;
const ARCHIVE_RETENTION_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const ARCHIVE_FAILURE_CODE = 'archive_creation_failed';
const FOLDER_UNAVAILABLE_FAILURE_CODE = 'folder_unavailable';
const TOO_MANY_FILES_FAILURE_CODE = 'folder_download_too_many_files';
const ARCHIVE_TOO_LARGE_FAILURE_CODE = 'folder_download_too_large';
const DEFAULT_FOLDER_DOWNLOAD_LIMITS: FolderDownloadLimitsConfig = {
  maxFiles: DEFAULT_FOLDER_DOWNLOAD_MAX_FILES,
  maxTotalBytes: DEFAULT_FOLDER_DOWNLOAD_MAX_TOTAL_BYTES,
};

export class FolderDownloadProcessor {
  constructor(
    private readonly repository: FolderDownloadRepository,
    private readonly archiver: FolderArchiver,
    private readonly limits: FolderDownloadLimitsConfig = DEFAULT_FOLDER_DOWNLOAD_LIMITS,
  ) {}

  async processNext(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const claimedAt = new Date();

    const download = await this.repository.claimNext({
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + LEASE_DURATION_MS),
      maxAttempts: MAX_ATTEMPTS,
    });

    if (!download) {
      return false;
    }

    await this.processClaimedDownload(download, signal);
    return true;
  }

  private async processClaimedDownload(
    download: FolderDownload,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    const leaseController = new AbortController();
    const attemptSignal = externalSignal
      ? AbortSignal.any([externalSignal, leaseController.signal])
      : leaseController.signal;

    const state: {
      finalizing: boolean;
      activeRenewal: Promise<void> | null;
    } = {
      finalizing: false,
      activeRenewal: null,
    };

    const leaseTimer = setInterval(() => {
      if (state.finalizing || state.activeRenewal !== null || attemptSignal.aborted) {
        return;
      }

      const renewedAt = new Date();
      const renewal = this.repository
        .renewLease({
          id: download.id,
          attemptCount: download.attemptCount,
          leaseExpiresAt: new Date(renewedAt.getTime() + LEASE_DURATION_MS),
        })
        .then((renewed) => {
          if (!renewed && !state.finalizing) {
            console.warn('Folder download lease lost; aborting archive creation', {
              downloadId: download.downloadId,
              attemptCount: download.attemptCount,
            });
            leaseController.abort(new Error('Folder download lease lost'));
          }
        })
        .catch((error: unknown) => {
          console.error('Folder download lease renewal failed', {
            downloadId: download.downloadId,
            attemptCount: download.attemptCount,
            error,
          });
        })
        .finally(() => {
          if (state.activeRenewal === renewal) {
            state.activeRenewal = null;
          }
        });

      state.activeRenewal = renewal;
    }, LEASE_RENEWAL_INTERVAL_MS);
    leaseTimer.unref();

    const stopLeaseRenewal = () => {
      state.finalizing = true;
      clearInterval(leaseTimer);
    };

    const releaseOnShutdown = async () => {
      stopLeaseRenewal();
      await state.activeRenewal?.catch(() => undefined);
      if (!leaseController.signal.aborted) {
        await this.releaseLeaseOnShutdown(download);
      }
    };

    try {
      const archiveObjectKey = `${download.archiveObjectKey}/${download.attemptCount}.zip`;
      const entries = await this.repository.getArchiveManifest({
        ownerId: download.ownerId,
        rootFolderId: download.folderId,
        rootFolderName: download.folderName,
      });

      if (leaseController.signal.aborted) {
        return;
      }

      if (externalSignal?.aborted) {
        await releaseOnShutdown();
        return;
      }

      if (entries.length === 0) {
        stopLeaseRenewal();
        await this.markFailed(download, FOLDER_UNAVAILABLE_FAILURE_CODE);
        return;
      }

      let fileCount = 0;
      let totalSizeBytes = 0;
      for (const entry of entries) {
        if (entry.kind === 'file') {
          fileCount += 1;
          totalSizeBytes += entry.sizeBytes;
        }
      }

      if (fileCount > this.limits.maxFiles) {
        stopLeaseRenewal();
        await this.markFailed(download, TOO_MANY_FILES_FAILURE_CODE);
        return;
      }

      if (totalSizeBytes > this.limits.maxTotalBytes) {
        stopLeaseRenewal();
        await this.markFailed(download, ARCHIVE_TOO_LARGE_FAILURE_CODE);
        return;
      }

      let archiveResult: CreateFolderArchiveResult;

      try {
        archiveResult = await this.archiver.create({
          entries,
          archiveObjectKey,
          signal: attemptSignal,
        });
      } catch (error) {
        if (leaseController.signal.aborted) {
          return;
        }

        if (externalSignal?.aborted) {
          await releaseOnShutdown();
          console.warn('Folder download processing aborted due to worker shutdown', {
            downloadId: download.downloadId,
            attemptCount: download.attemptCount,
          });
          return;
        }

        stopLeaseRenewal();
        await this.markFailed(download, ARCHIVE_FAILURE_CODE, error);
        return;
      }

      stopLeaseRenewal();
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
    } finally {
      stopLeaseRenewal();
      await state.activeRenewal?.catch(() => undefined);
    }
  }

  private async releaseLeaseOnShutdown(download: FolderDownload): Promise<void> {
    try {
      await this.repository.renewLease({
        id: download.id,
        attemptCount: download.attemptCount,
        leaseExpiresAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to release folder download lease on shutdown', {
        downloadId: download.downloadId,
        attemptCount: download.attemptCount,
        error,
      });
    }
  }

  private async markFailed(
    download: FolderDownload,
    failureCode: string,
    error?: unknown,
  ): Promise<void> {
    const markedFailed = await this.repository.markFailed({
      id: download.id,
      attemptCount: download.attemptCount,
      failureCode,
      finishedAt: new Date(),
    });

    console.error('Folder download processing failed', {
      downloadId: download.downloadId,
      attemptCount: download.attemptCount,
      failureCode,
      markedFailed,
      ...(error !== undefined ? { error } : {}),
    });
  }
}
