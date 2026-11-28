import { randomUUID } from 'node:crypto';
import type { AuditRepository } from '../../audit/audit-repository.js';
import type { EntryAuthorizer } from '../../authorization/entry-authorizer.js';
import {
  DEFAULT_FOLDER_DOWNLOAD_MAX_FILES,
  DEFAULT_FOLDER_DOWNLOAD_MAX_TOTAL_BYTES,
  type FolderDownloadLimitsConfig,
} from '../../config.js';
import type { UnitOfWork } from '../../db/unit-of-work.js';
import type { User } from '../../user/user.js';
import type {
  CreateFolderDownloadResponse,
  FolderDownloadStatusBase,
  FolderDownloadStatusResponse,
} from './dto.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';
import { AppError } from '../../shared/errors/api/app-error.js';
import { getErrorDefinition } from '../../shared/errors/api/error-catalog.js';
import type { ObjectStorage } from '../../storage/object-storage.js';

const DOWNLOAD_URL_EXPIRES_IN_SECONDS = 60;
const DEFAULT_FOLDER_DOWNLOAD_LIMITS: FolderDownloadLimitsConfig = {
  maxFiles: DEFAULT_FOLDER_DOWNLOAD_MAX_FILES,
  maxTotalBytes: DEFAULT_FOLDER_DOWNLOAD_MAX_TOTAL_BYTES,
};

const USER_FACING_FAILURE_CODES = new Set([
  'folder_download_too_many_files',
  'folder_download_too_large',
] as const);

type UserFacingFolderDownloadFailureCode =
  | 'folder_download_too_many_files'
  | 'folder_download_too_large';

function isUserFacingFailureCode(code: string | null): code is UserFacingFolderDownloadFailureCode {
  return (
    code !== null && USER_FACING_FAILURE_CODES.has(code as UserFacingFolderDownloadFailureCode)
  );
}

export class FolderDownloadService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly entryAuthorizer: EntryAuthorizer,
    private readonly repository: FolderDownloadRepository,
    private readonly auditRepository: AuditRepository,
    private readonly storage: ObjectStorage,
    private readonly limits: FolderDownloadLimitsConfig = DEFAULT_FOLDER_DOWNLOAD_LIMITS,
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

      const summary = await this.repository.getArchiveSummary(
        {
          ownerId: user.id,
          rootFolderId: folder.id,
        },
        tx,
      );

      if (summary.fileCount > this.limits.maxFiles) {
        throw new AppError('folder_download_too_many_files', {
          context: {
            fileCount: summary.fileCount,
            maxFiles: this.limits.maxFiles,
          },
        });
      }

      if (summary.totalSizeBytes > this.limits.maxTotalBytes) {
        throw new AppError('folder_download_too_large', {
          context: {
            totalSizeBytes: summary.totalSizeBytes,
            maxTotalBytes: this.limits.maxTotalBytes,
          },
        });
      }

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
        if (isUserFacingFailureCode(download.failureCode)) {
          return {
            ...base,
            status: 'failed',
            failureCode: download.failureCode,
            message: getErrorDefinition(download.failureCode).message,
          };
        }

        return {
          ...base,
          status: 'failed',
        };

      case 'expired':
        return {
          ...base,
          status: 'expired',
        };
    }
  }
}
