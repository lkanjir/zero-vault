import { randomUUID } from 'node:crypto';
import type { S3ObjectStorage } from '../s3-object-storage.js';
import type { UploadResponse } from './dto.js';
import type { UploadRequestBody } from './upload-schema.js';
import type { UploadIntentRepository } from './upload-intent-repository.js';
import type { UploadIntent } from './object-storage.js';

export class StorageService {
  private readonly EXPIRES_IN_SECONDS = 60;

  constructor(
    private readonly storage: S3ObjectStorage,
    private readonly repo: UploadIntentRepository,
  ) {}

  async createUpload(request: UploadRequestBody): Promise<UploadResponse> {
    const uploadId = randomUUID();
    const objectKey = `uploads/${randomUUID()}-${request.fileName}`;

    const intent: UploadIntent = {
      id: uploadId,
      objectKey: objectKey,
      fileName: request.fileName,
      contentType: request.contentType,
      size: request.size,
      status: 'pending',
      createdAt: new Date(),
      expiredAt: new Date(Date.now() + this.EXPIRES_IN_SECONDS * 1000),
    };

    this.repo.save(intent);

    const uploadUrl = await this.storage.createPresignedUrl({
      objectKey: objectKey,
      contentType: request.contentType,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
    });

    const response: UploadResponse = {
      uploadId,
      objectKey,
      uploadUrl,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
    };

    return response;
  }
}
