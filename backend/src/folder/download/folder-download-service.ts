import { randomUUID } from 'node:crypto';
import type { User } from '../../user/user.js';
import type {
  CreateFolderDownloadResponse,
  FolderDownloadStatusBase,
  FolderDownloadStatusResponse,
} from './dto.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';
import { AppError } from '../../shared/errors/api/app-error.js';
import type { ObjectStorage } from '../../storage/object-storage.js';
import { StorageError } from '../../shared/errors/storage/storage-error.js';

const DOWNLOAD_URL_EXPIRES_IN_SECONDS = 60;

export class FolderDownloadService {
  constructor(
    private readonly repository: FolderDownloadRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async createDownload(user: User, folderPublicId: string): Promise<CreateFolderDownloadResponse> {
    const downloadId = randomUUID();
    const createdAt = new Date();
    const archiveObjectKey = `folder-downloads/${user.publicId}/${downloadId}`;

    const download = await this.repository.create({
      downloadId,
      ownerId: user.id,
      folderPublicId,
      archiveObjectKey,
      createdAt,
    });

    return {
      downloadId: download.downloadId,
      fileName: `${download.folderName}.zip`,
      status: 'queued',
    };
  }

  async getStatus(user: User, downloadId: string): Promise<FolderDownloadStatusResponse> {
    const download = await this.repository.findByOwnerAndDownloadId(user.id, downloadId);

    if (!download) {
      throw new AppError('folder_download_not_found');
    }

    const base: FolderDownloadStatusBase = {
      downloadId: download.downloadId,
      fileName: `${download.folderName}.zip`,
    };

    let downloadUrl;

    switch (download.status) {
      case 'queued':
      case 'processing':
        return {
          ...base,
          status: download.status,
        };

      case 'ready':
        if (download.archiveSizeBytes === null || download.expiresAt === null) {
          throw new AppError('internal_server_error');
        }

        if (download.expiresAt.getTime() <= Date.now()) {
          return {
            ...base,
            status: 'expired',
          };
        }

        try {
          downloadUrl = await this.storage.createPresignedDownloadUrl({
            objectKey: download.archiveObjectKey,
            fileName: `${download.folderName}.zip`,
            contentType: 'application/zip',
            expiresInSeconds: DOWNLOAD_URL_EXPIRES_IN_SECONDS,
          });
        } catch (error) {
          if (error instanceof StorageError) {
            throw new AppError('storage_unavailable', {
              cause: error,
              context: {
                downloadId: download.downloadId,
                objectKey: download.archiveObjectKey,
                storageOperation: error.context.operation,
              },
            });
          }

          throw error;
        }

        return {
          ...base,
          status: 'ready',
          sizeBytes: download.archiveSizeBytes,
          expiresAt: download.expiresAt.toISOString(),
          downloadUrl,
          expiresInSeconds: DOWNLOAD_URL_EXPIRES_IN_SECONDS,
        };

      case 'failed':
      case 'expired':
        return {
          ...base,
          status: download.status,
        };
    }
  }
}
