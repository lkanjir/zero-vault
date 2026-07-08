import type { FilePromotionService } from '../files/file-promotion-service.js';
import type { User } from '../user/user.js';
import type { UploadCompleteResponse } from './dto.js';
import type { UploadService } from './upload-service.js';

export class CompleteUploadUseCase {
  constructor(
    private readonly uploadService: UploadService,
    private readonly promotionService: FilePromotionService,
  ) {}

  async execute(user: User, uploadId: string): Promise<UploadCompleteResponse> {
    const completedUpload = await this.uploadService.completeUpload(user, uploadId);
    const promotedFile = await this.promotionService.promoteFile(completedUpload.entryId);

    return {
      uploadId: completedUpload.uploadId,
      fileId: completedUpload.fileId,
      fileName: completedUpload.fileName,
      contentType: promotedFile.contentType,
      sizeBytes: promotedFile.sizeBytes,
      fileStatus: promotedFile.status,
    };
  }
}
