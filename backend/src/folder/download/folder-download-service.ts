import { randomUUID } from 'node:crypto';
import type { User } from '../../user/user.js';
import type {
  CreateFolderDownloadResponse,
  FolderDownloadStatusBase,
  FolderDownloadStatusResponse,
} from './dto.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';
import { AppError } from '../../shared/errors/api/app-error.js';

export class FolderDownloadService {
  constructor(private readonly repository: FolderDownloadRepository) {}

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

        return {
          ...base,
          status: 'ready',
          sizeBytes: download.archiveSizeBytes,
          expiresAt: download.expiresAt.toISOString(),
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
