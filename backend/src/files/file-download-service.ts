import { AppError } from '../shared/errors/api/app-error.js';
import { StorageError } from '../shared/errors/storage/storage-error.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import type { User } from '../user/user.js';
import type { FileDownloadResponse } from './dto.js';
import type { FileRepository } from './file-repository.js';
import type { DownloadableFile } from './file.js';

export class FileDownloadService {
  private readonly EXPIRES_IN_SECONDS = 60;

  constructor(
    private readonly repo: FileRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async createDownloadUrl(user: User, fileId: string): Promise<FileDownloadResponse> {
    const file = await this.repo.findAvailableFileByPublicIdForOwner(fileId, user.id);

    if (!file) {
      throw new AppError('file_not_found');
    }

    const downloadUrl = await this.createPresignedDownloadUrl(file);

    return {
      contentType: file.contentType,
      downloadUrl: downloadUrl,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      fileId: file.publicId,
      fileName: file.name,
      sizeBytes: file.sizeBytes,
    };
  }

  private async createPresignedDownloadUrl(file: DownloadableFile): Promise<string> {
    try {
      return await this.storage.createPresignedDownloadUrl({
        objectKey: file.objectKey,
        contentType: file.contentType,
        expiresInSeconds: this.EXPIRES_IN_SECONDS,
        fileName: file.name,
      });
    } catch (error) {
      if (error instanceof StorageError) {
        throw new AppError('storage_unavailable', {
          cause: error,
          context: {
            fileId: file.publicId,
            objectKey: file.objectKey,
            storageOperation: error.context.operation,
          },
        });
      }

      throw error;
    }
  }
}
