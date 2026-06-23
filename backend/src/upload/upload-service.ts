import { randomUUID } from 'node:crypto';
import type { UploadUrlResponse, UploadUrlRequest } from './ObjectStorage.js';
import type { S3ObjectStorage } from '../S3ObjectStorage.js';

export class StorageService {
  constructor(private readonly storage: S3ObjectStorage) {}

  async createUpload(params: UploadUrlRequest): Promise<UploadUrlResponse> {
    const objectKey = `uploads/${randomUUID()}-${params.fileName}`;

    const uploadUrl = await this.storage.createPresignedUrl({
      objectKey: objectKey,
      contentType: params.contentType,
      expiresInSeconds: 60,
    });

    const response: UploadUrlResponse = {
      objectKey: objectKey,
      uploadUrl: uploadUrl,
      expiresInSeconds: 60,
    };

    return response;
  }
}
