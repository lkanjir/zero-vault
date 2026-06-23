import { randomUUID } from 'node:crypto';
import type { UploadCompleteResponse, UploadResponse } from './dto.js';
import type { UploadRequestBody } from './upload-schema.js';
import type { UploadIntentRepository } from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { ConflictError } from '../shared/errors/conflict-error.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';

export class StorageService {
  private readonly EXPIRES_IN_SECONDS = 60;

  constructor(
    private readonly storage: ObjectStorage,
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

  completeUpload(uploadId: string): UploadCompleteResponse {
    const pendingIntent = this.repo.findById(uploadId);

    if (!pendingIntent) {
      throw new NotFoundError("Upload intent doesn't exist");
    }

    if (pendingIntent.status !== 'pending') {
      throw new ConflictError('Upload intent is not pending');
    }

    if (pendingIntent.expiredAt.getTime() < Date.now()) {
      pendingIntent.status = 'expired';
      this.repo.update(pendingIntent);

      throw new ConflictError('Upload intent expired');
    }

    pendingIntent.status = 'completed';
    this.repo.update(pendingIntent);

    const result: UploadCompleteResponse = {
      uploadId: pendingIntent.id,
      objectKey: pendingIntent.objectKey,
      fileName: pendingIntent.fileName,
      contentType: pendingIntent.fileName,
      size: pendingIntent.size,
      status: pendingIntent.status,
    };

    return result;
  }
}
