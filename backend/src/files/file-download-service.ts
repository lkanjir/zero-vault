import type { ObjectStorage } from '../storage/object-storage.js';
import type { User } from '../user/user.js';
import type { DownloadResponse } from './dto.js';
import type { FileRepository } from './file-repository.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';

export class FileDonwloadService {
  private readonly EXIRES_IN_SECONDS = 60;

  constructor(
    private readonly repo: FileRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async createDownloadUrl(user: User, fileId: string): Promise<DownloadResponse> {
    const file = await this.repo.findAvailableFileByPublicIdForOwner(fileId, user.id);

    if (!file) {
      throw new NotFoundError('File not found');
    }

    const downloadUrl = await this.storage.createPresignedDownloadUrl({
      objectKey: file.objectKey,
      contentType: file.contentType,
      expiresInSeconds: this.EXIRES_IN_SECONDS,
      fileName: file.name,
    });

    return {
      contentType: file.contentType,
      downloadUrl: downloadUrl,
      expiresInSeconds: this.EXIRES_IN_SECONDS,
      fileId: file.publicId,
      fileName: file.name,
      sizeBytes: file.sizeBytes,
    };
  }
}
