import { randomUUID } from 'node:crypto';
import type { UploadResponse } from './dto.js';
import type { UploadRequestBody } from './validation-schemas.js';
import type { UploadIntent } from './upload-intent.js';
import type { ObjectMetadata, ObjectStorage } from '../storage/object-storage.js';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';
import type {
  CompletedUploadFile,
  CompletedVerifiedUploadResult,
  UploadIntentRepository,
} from './upload-intent-repository.js';
import type { User } from '../user/user.js';
import {
  assertChecksumExists,
  assertChecksumMatches,
  assertContentTypeMatches,
  assertObjectKeyMatches,
  assertSizeMatches,
} from './metadata-assertions.js';
import { sha256HexToBase64 } from '../shared/utils/sha256-convert.js';
import { AppError } from '../shared/errors/api/app-error.js';

export class UploadService {
  private readonly EXPIRES_IN_SECONDS = 60;
  private readonly FINALIZE_DEADLINE_SECONDS = this.EXPIRES_IN_SECONDS * 60;

  constructor(
    private readonly storage: ObjectStorage,
    private readonly intentRepo: UploadIntentRepository,
  ) {}

  async createUpload(user: User, requestBody: UploadRequestBody): Promise<UploadResponse> {
    const parentFolderId = requestBody.parentFolderId ?? null;
    await this.intentRepo.assertUploadTargetAvailable({
      userId: user.id,
      parentFolderId,
      fileName: requestBody.fileName,
    });

    const objectId = randomUUID();
    const objectKey = `users/${user.publicId}/objects/${objectId}`;
    const contentType = normalizedContentType(requestBody.contentType);
    const uploadId = randomUUID();

    const intent: UploadIntent = {
      uploadId: uploadId,
      createdByUserId: user.id,
      fileName: requestBody.fileName,
      objectKey: objectKey,
      contentType: contentType,
      expectedSizeBytes: requestBody.size,
      expectedSha256: requestBody.sha256,
      status: 'pending',
      createdAt: new Date(),
      uploadUrlExpiresAt: new Date(Date.now() + this.EXPIRES_IN_SECONDS * 1000),
      finalizeDeadline: new Date(Date.now() + this.FINALIZE_DEADLINE_SECONDS * 1000),
    };

    const uploadUrl = await this.storage.createPresignedUploadUrl({
      objectKey: objectKey,
      contentType: contentType,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      sha256Hex: requestBody.sha256,
    });

    await this.intentRepo.save({
      ...intent,
      parentFolderId,
    });

    const response: UploadResponse = {
      uploadId,
      uploadUrl,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      requiredHeaders: {
        'Content-Type': intent.contentType,
        'x-amz-checksum-sha256': sha256HexToBase64(intent.expectedSha256),
      },
    };

    return response;
  }

  async completeUpload(user: User, uploadId: string): Promise<CompletedUploadFile> {
    const intent = await this.getUploadIntent(user.id, uploadId);

    if (this.shouldVerifyUploadedObject(intent)) {
      const uploadedObject = await this.storage.headObject(intent.objectKey);
      this.verifyUpload(intent, uploadedObject);
    }

    const result = await this.intentRepo.completeVerifiedUpload({
      userId: user.id,
      uploadId: intent.uploadId,
      completedAt: new Date(),
    });

    return this.mapCompletionResult(result);
  }

  private async getUploadIntent(userId: number, uploadId: string): Promise<UploadIntent> {
    const intent = await this.intentRepo.findByUserAndUploadId(userId, uploadId);

    if (!intent) {
      throw new AppError('upload_not_found');
    }

    return intent;
  }

  private shouldVerifyUploadedObject(intent: UploadIntent): boolean {
    return intent.status === 'pending' && intent.finalizeDeadline.getTime() >= Date.now();
  }

  private verifyUpload(intent: UploadIntent, object: ObjectMetadata): void {
    assertObjectKeyMatches(intent, object);
    assertChecksumExists(object);
    assertChecksumMatches(intent, object);
    assertSizeMatches(intent, object);
    assertContentTypeMatches(intent, object);
  }

  private mapCompletionResult(result: CompletedVerifiedUploadResult): CompletedUploadFile {
    switch (result.kind) {
      case 'completed':
        return result.file;
      case 'not_found':
        throw new AppError('upload_not_found');
      case 'expired':
        throw new AppError('upload_expired');
    }
  }
}
