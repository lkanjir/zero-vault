import type { FileResponse } from '../files/dto.js';
import type { User } from '../user/user.js';
import type { UploadService } from './upload-service.js';

export class CompleteUploadUseCase {
  constructor(private readonly uploadService: UploadService) {}

  async execute(user: User, uploadId: string): Promise<FileResponse> {
    const file = await this.uploadService.completeUpload(user, uploadId);

    return {
      kind: 'file',
      id: file.publicId,
      name: file.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      updatedAt: file.updatedAt.toISOString(),
    };
  }
}
