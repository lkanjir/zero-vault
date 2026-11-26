import { randomUUID } from 'node:crypto';
import type { AuditRepository } from '../../audit/audit-repository.js';
import type { EntryAuthorizer } from '../../authorization/entry-authorizer.js';
import type { UnitOfWork } from '../../db/unit-of-work.js';
import type { User } from '../../user/user.js';
import type {
  CreateFolderDownloadResponse,
  FolderDownloadStatusBase,
  FolderDownloadStatusResponse,
} from './dto.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';
import { AppError } from '../../shared/errors/api/app-error.js';
import type { ObjectStorage } from '../../storage/object-storage.js';

const DOWNLOAD_URL_EXPIRES_IN_SECONDS = 60;

export class FolderDownloadService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly entryAuthorizer: EntryAuthorizer,
    private readonly repository: FolderDownloadRepository,
    private readonly auditRepository: AuditRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async createDownload(user: User, folderPublicId: string): Promise<CreateFolderDownloadResponse> {
    return this.unitOfWork.run(async (tx) => {
      const { entry: folder } = await this.entryAuthorizer.authorizeForRead(
        {
          actorUserId: user.id,
          entryPublicId: folderPublicId,
          actions: ['folder:download'],
        },
        tx,
      );

      const downloadId = randomUUID();
      const createdAt = new Date();
      const archiveObjectKey = `folder-downloads/${user.publicId}/${downloadId}`;

      const download = await this.repository.create(
        {
          downloadId,
          ownerId: user.id,
          folderId: folder.id,
          folderName: folder.name,
          archiveObjectKey,
          createdAt,
        },
        tx,
      );

      await this.auditRepository.record(
        {
          ownerId: folder.ownerId,
          actorUserId: user.id,
          entryId: folder.id,
          entryNameSnapshot: folder.name,
          action: 'folder.archive_requested',
          details: {
            downloadId,
          },
          occurredAt: createdAt,
        },
        tx,
      );

      return {
        downloadId: download.downloadId,
        fileName: `${download.folderName}.zip`,
        status: 'queued',
      };
    });
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

        downloadUrl = await this.storage.createPresignedDownloadUrl({
          objectKey: download.archiveObjectKey,
          fileName: `${download.folderName}.zip`,
          contentType: 'application/zip',
          expiresInSeconds: DOWNLOAD_URL_EXPIRES_IN_SECONDS,
        });

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
