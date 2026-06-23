import { randomUUID } from 'node:crypto';
import type { UploadCompleteResponse, UploadResponse } from './dto.js';
import type { UploadRequestBody } from './validation-schemas.js';
import type { UploadIntent } from './upload-intent.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { ConflictError } from '../shared/errors/conflict-error.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';
import type { UploadIntentRepository } from './upload-intent-repository.js';

export class UploadService {
  private readonly EXPIRES_IN_SECONDS = 60;

  constructor(
    private readonly storage: ObjectStorage,
    private readonly repo: UploadIntentRepository,
  ) {}

  async createUpload(request: UploadRequestBody): Promise<UploadResponse> {
    const uploadId = randomUUID();
    const objectKey = `uploads/pending/${uploadId}/${randomUUID()}`;

    const contentType = normalizedContentType(request.contentType);

    const intent: UploadIntent = {
      uploadId: uploadId,
      objectKey: objectKey,
      fileName: request.fileName,
      contentType: contentType,
      size: request.size,
      status: 'pending',
      createdAt: new Date(),
      expiredAt: new Date(Date.now() + this.EXPIRES_IN_SECONDS * 1000),
    };

    const uploadUrl = await this.storage.createPresignedUrl({
      objectKey: objectKey,
      contentType: contentType,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
    });

    await this.repo.save(intent);

    const response: UploadResponse = {
      uploadId,
      objectKey,
      uploadUrl,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
    };

    return response;
  }

  async completeUpload(uploadId: string): Promise<UploadCompleteResponse> {
    const pendingIntent = await this.repo.findById(uploadId);

    if (!pendingIntent) {
      throw new NotFoundError("Upload intent doesn't exist");
    }

    if (pendingIntent.status !== 'pending') {
      throw new ConflictError('Upload intent is not pending');
    }

    if (pendingIntent.expiredAt.getTime() < Date.now()) {
      pendingIntent.status = 'expired';
      await this.repo.update(pendingIntent);

      throw new ConflictError('Upload intent expired');
    }

    const savedObject = await this.storage.headObject(pendingIntent.objectKey);

    if (savedObject.objectKey !== pendingIntent.objectKey) {
      throw new ConflictError('Uploaded object key does not match intent');
    }

    if (savedObject.size !== pendingIntent.size) {
      throw new ConflictError('Uploaded object size does not match intent');
    }

    if (savedObject.contentType !== pendingIntent.contentType) {
      throw new ConflictError('Uploaded object content type does not match intent');
    }

    pendingIntent.status = 'completed';
    pendingIntent.completedAt = new Date();
    await this.repo.update(pendingIntent);

    const result: UploadCompleteResponse = {
      uploadId: pendingIntent.uploadId,
      objectKey: savedObject.objectKey,
      fileName: pendingIntent.fileName,
      contentType: savedObject.contentType,
      size: savedObject.size,
      status: pendingIntent.status,
    };

    return result;
  }
}
