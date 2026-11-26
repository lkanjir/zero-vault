import type { AuditRepository } from '../audit/audit-repository.js';
import type { AuthorizationService } from '../authorization/authorization-service.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import type { User } from '../user/user.js';
import type { FileDownloadResponse } from './dto.js';
import type { FileRepository } from './file-repository.js';
import type { DownloadableFile } from './file.js';

export class FileDownloadService {
  private readonly EXPIRES_IN_SECONDS = 60;

  constructor(
    private readonly authzService: AuthorizationService,
    private readonly fileRepo: FileRepository,
    private readonly auditRepo: AuditRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async createDownloadUrl(user: User, fileId: string): Promise<FileDownloadResponse> {
    const authorization = await this.authzService.authorizeEntryByPublicId({
      actorUserId: user.id,
      entryPublicId: fileId,
      action: 'file:download',
    });

    const file = await this.fileRepo.findAvailableFileByEntryId(authorization.context.resource.id);

    if (!file) {
      throw new AppError('file_not_found');
    }

    const downloadUrl = await this.createPresignedDownloadUrl(file);

    await this.auditRepo.record({
      ownerId: file.ownerId,
      actorUserId: user.id,
      entryId: file.entryId,
      entryNameSnapshot: file.name,
      action: 'file.download_url_issued',
      details: {
        expiresInSeconds: this.EXPIRES_IN_SECONDS,
      },
      occurredAt: new Date(),
    });

    return {
      contentType: file.contentType,
      downloadUrl: downloadUrl,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      fileId: file.publicId,
      fileName: file.name,
      sizeBytes: file.sizeBytes,
    };
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
