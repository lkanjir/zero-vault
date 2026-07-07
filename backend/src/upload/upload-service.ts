import { randomUUID } from 'node:crypto';
import type { UploadCompleteResponse, UploadResponse } from './dto.js';
import type { UploadRequestBody } from './validation-schemas.js';
import type { UploadIntent } from './upload-intent.js';
import type {
  ObjectMetadata,
  ObjectStorage,
  ObjectMetadataWithChecksum,
} from '../storage/object-storage.js';
import { ConflictError } from '../shared/errors/conflict-error.js';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';
import type { UploadIntentRepository } from './upload-intent-repository.js';
import { sha256HexToBase64 } from '../shared/utils/sha256-convert.js';
import type { User } from '../user/user.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';
import {
  assertChecksumExists,
  assertChecksumMatches,
  assertContentTypeMatches,
  assertObjectKeyMatches,
  assertSizeMatches,
} from './metadata-assertions.js';

export class UploadService {
  private readonly EXPIRES_IN_SECONDS = 60;
  private readonly FINALIZE_DEADLINE = this.EXPIRES_IN_SECONDS * 60;

  constructor(
    private readonly storage: ObjectStorage,
    private readonly intentRepo: UploadIntentRepository,
  ) {}

  async createUpload(user: User, requestBody: UploadRequestBody): Promise<UploadResponse> {
    const uploadId = randomUUID();
    const objectKey = `quarantine/${uploadId}/${randomUUID()}`;

    const contentType = normalizedContentType(requestBody.contentType);

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
      finalizeDeadline: new Date(Date.now() + this.FINALIZE_DEADLINE * 1000),
    };

    const uploadUrl = await this.storage.createPresignedUrl({
      objectKey: objectKey,
      contentType: contentType,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      sha256Hex: requestBody.sha256,
    });

    await this.intentRepo.save(intent);

    const response: UploadResponse = {
      uploadId,
      uploadUrl,
      sha256Base64: sha256HexToBase64(requestBody.sha256),
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
    };

    return response;
  }

  async completeUpload(user: User, uploadId: string): Promise<UploadCompleteResponse> {
    const intent = await this.getPendingIntent(user.id, uploadId);

    await this.ensureIntentCanBeFinalized(intent);
    const uploadedObject = await this.storage.headObject(intent.objectKey);
    const verifiedObject = this.verifyUpload(intent, uploadedObject);

    const completeCommand = {
      userId: user.id,
      uploadId: intent.uploadId,
      objectKey: verifiedObject.objectKey,
      contentType: verifiedObject.contentType,
      sizeBytes: verifiedObject.size,
      sha256: verifiedObject.sha256Hex,
      completedAt: new Date(),
    };

    const completedFile = await this.intentRepo.completeVerifiedUpload(completeCommand);

    if (!completedFile) {
      throw new ConflictError('Upload intent is not pending');
    }

    return {
      uploadId: intent.uploadId,
      fileId: completedFile.publicId,
      fileName: completedFile.name,
      contentType: completeCommand.contentType,
      sizeBytes: completedFile.sizeBytes,
      fileStatus: completedFile.status,
    };
  }

  private async getPendingIntent(userId: number, uploadId: string): Promise<UploadIntent> {
    const intent = await this.intentRepo.findByUserAndUploadId(userId, uploadId);

    if (!intent) {
      throw new NotFoundError("Upload intent doesn't exist");
    }

    if (intent.status !== 'pending') {
      throw new ConflictError('Upload intent is not pending');
    }

    return intent;
  }

  private verifyUpload(intent: UploadIntent, object: ObjectMetadata): ObjectMetadataWithChecksum {
    assertObjectKeyMatches(intent, object);
    assertChecksumExists(object);
    assertChecksumMatches(intent, object);
    assertSizeMatches(intent, object);
    assertContentTypeMatches(intent, object);

    return {
      ...object,
      sha256Hex: object.sha256Hex,
    };
  }

  private async ensureIntentCanBeFinalized(intent: UploadIntent): Promise<void> {
    if (intent.finalizeDeadline.getTime() >= Date.now()) {
      return;
    }

    const expired = await this.intentRepo.markedExpiredIfPending(
      intent.createdByUserId,
      intent.uploadId,
    );

    if (!expired) {
      throw new ConflictError('Upload intent is not pending');
    }

    throw new ConflictError('Upload intent expired');
  }
}
