import type { User } from '../user/user.js';
import type { UploadCompleteResponse } from './dto.js';
import type { UploadService } from './upload-service.js';

export class CompleteUploadUseCase {
  constructor(private readonly uploadService: UploadService) {}

  async execute(user: User, uploadId: string): Promise<UploadCompleteResponse> {
    const completedUpload = await this.uploadService.completeUpload(user, uploadId);

    return {
      uploadId: completedUpload.uploadId,
      fileId: completedUpload.fileId,
      fileName: completedUpload.fileName,
      contentType: completedUpload.contentType,
      sizeBytes: completedUpload.sizeBytes,
      fileStatus: completedUpload.fileStatus,
    };
  }
}
