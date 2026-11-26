import type { AuditRepository } from '../audit/audit-repository.js';
import type { EntryAuthorizer } from '../authorization/entry-authorizer.js';
import type { UnitOfWork } from '../db/unit-of-work.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import type { User } from '../user/user.js';
import type { FileDownloadResponse } from './dto.js';
import type { FileRepository } from './file-repository.js';
import type { DownloadableFile } from './file.js';

export class FileDownloadService {
  private readonly EXPIRES_IN_SECONDS = 60;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly entryAuthorizer: EntryAuthorizer,
    private readonly fileRepo: FileRepository,
    private readonly auditRepo: AuditRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async createDownloadUrl(user: User, fileId: string): Promise<FileDownloadResponse> {
    return this.unitOfWork.run(async (tx) => {
      const authorized = await this.entryAuthorizer.authorizeForRead(
        {
          actorUserId: user.id,
          entryPublicId: fileId,
          actions: ['file:download'],
        },
        tx,
      );

      const file = await this.fileRepo.findAvailableFileByEntryId(authorized.entry.id, tx);

      if (!file) {
        throw new AppError('file_not_found');
      }

      const downloadUrl = await this.createPresignedDownloadUrl(file);

      await this.auditRepo.record(
        {
          ownerId: file.ownerId,
          actorUserId: user.id,
          entryId: file.entryId,
          entryNameSnapshot: file.name,
          action: 'file.download_url_issued',
          details: {
            expiresInSeconds: this.EXPIRES_IN_SECONDS,
          },
          occurredAt: new Date(),
        },
        tx,
      );

      return {
        contentType: file.contentType,
        downloadUrl,
        expiresInSeconds: this.EXPIRES_IN_SECONDS,
        fileId: file.publicId,
        fileName: file.name,
        sizeBytes: file.sizeBytes,
      };
    });
  }

  private createPresignedDownloadUrl(file: DownloadableFile): Promise<string> {
    return this.storage.createPresignedDownloadUrl({
      objectKey: file.objectKey,
      contentType: file.contentType,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      fileName: file.name,
    });
  }
}
