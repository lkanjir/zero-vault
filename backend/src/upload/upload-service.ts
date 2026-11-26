import { randomUUID } from 'node:crypto';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { EntryAuthorizer } from '../authorization/entry-authorizer.js';
import type { TransactionContext, UnitOfWork } from '../db/unit-of-work.js';
import type { FileResponse } from '../files/dto.js';
import { AppError } from '../shared/errors/api/app-error.js';
import { StorageObjectNotFoundError } from '../shared/errors/storage/storage-object-not-found-error.js';
import { sha256HexToBase64 } from '../shared/utils/sha256-convert.js';
import type { ObjectMetadata, ObjectStorage } from '../storage/object-storage.js';
import type { User } from '../user/user.js';
import type { UploadResponse } from './dto.js';
import {
  assertChecksumExists,
  assertChecksumMatches,
  assertContentTypeMatches,
  assertObjectKeyMatches,
  assertSizeMatches,
} from './metadata-assertions.js';
import type { CompletedUploadFile, UploadIntentRepository } from './upload-intent-repository.js';
import type { UploadIntent, UploadIntentInput } from './upload-intent.js';
import type { ReplacementUploadRequestBody, UploadRequestBody } from './validation-schemas.js';

type CompleteUploadOutcome =
  | { kind: 'completed'; file: CompletedUploadFile }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'aborted' }
  | { kind: 'superseded' }
  | { kind: 'duplicate_entry_name' };

export class UploadService {
  private readonly EXPIRES_IN_SECONDS = 600;
  private readonly FINALIZE_DEADLINE_SECONDS = 60 * 60;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly entryAuthorizer: EntryAuthorizer,
    private readonly storage: ObjectStorage,
    private readonly intentRepo: UploadIntentRepository,
    private readonly auditRepo: AuditRepository,
  ) {}

  async createUpload(user: User, requestBody: UploadRequestBody): Promise<UploadResponse> {
    const parentFolderId = requestBody.parentFolderId ?? null;
    const upload = this.createUploadIntentInput(user, requestBody);

    const uploadUrl = await this.unitOfWork.run(async (tx) => {
      const targetParentId = await this.entryAuthorizer.authorizeParentForCreate(
        {
          actorUserId: user.id,
          ownerId: user.id,
          parentPublicId: parentFolderId,
        },
        tx,
      );

      await this.intentRepo.assertUploadTargetAvailable(
        {
          userId: user.id,
          targetParentId,
          fileName: requestBody.fileName,
        },
        tx,
      );

      const presignedUrl = await this.createPresignedUploadUrl(upload);

      await this.intentRepo.save(
        {
          upload,
          targetParentId,
          fileName: requestBody.fileName,
        },
        tx,
      );

      return presignedUrl;
    });

    return this.toUploadResponse(upload, uploadUrl);
  }

  async createReplacementUpload(
    user: User,
    filePublicId: string,
    request: ReplacementUploadRequestBody,
  ): Promise<UploadResponse> {
    const upload = this.createUploadIntentInput(user, request);

    const uploadUrl = await this.unitOfWork.run(async (tx) => {
      const { entry: target } = await this.entryAuthorizer.authorizeForUpdate(
        {
          actorUserId: user.id,
          entryPublicId: filePublicId,
          actions: ['file:replace'],
        },
        tx,
      );

      const presignedUrl = await this.createPresignedUploadUrl(upload);

      await this.intentRepo.saveReplacement(
        {
          upload,
          targetFileId: target.id,
        },
        tx,
      );

      return presignedUrl;
    });

    return this.toUploadResponse(upload, uploadUrl);
  }

  async completeUpload(user: User, uploadId: string): Promise<FileResponse> {
    const intent = await this.getUploadIntent(user.id, uploadId);

    if (this.shouldVerifyUploadedObject(intent)) {
      const uploadedObject = await this.getUploadedObject(intent);
      this.verifyUpload(intent, uploadedObject);
    }

    const completedAt = new Date();
    const outcome = await this.unitOfWork.run((tx) =>
      this.completeUploadInTransaction(user, intent.uploadId, completedAt, tx),
    );

    return this.mapCompletionOutcome(outcome);
  }

  private async completeUploadInTransaction(
    user: User,
    uploadId: string,
    completedAt: Date,
    tx: TransactionContext,
  ): Promise<CompleteUploadOutcome> {
    const lockedIntent = await this.intentRepo.findByUserAndUploadIdForUpdate(
      user.id,
      uploadId,
      tx,
    );

    if (!lockedIntent) {
      return { kind: 'not_found' };
    }

    switch (lockedIntent.status) {
      case 'completed':
        return {
          kind: 'completed',
          file: await this.intentRepo.findCompletedFileByIntentId(lockedIntent.id, tx),
        };
      case 'expired':
        return { kind: 'expired' };
      case 'aborted':
        return { kind: 'aborted' };
      case 'superseded':
        return lockedIntent.operation === 'create'
          ? { kind: 'duplicate_entry_name' }
          : { kind: 'superseded' };
      case 'pending':
        return this.completePendingIntentInTransaction(user, lockedIntent, completedAt, tx);
    }
  }

  private async completePendingIntentInTransaction(
    user: User,
    intent: UploadIntent,
    completedAt: Date,
    tx: TransactionContext,
  ): Promise<CompleteUploadOutcome> {
    if (intent.finalizeDeadline.getTime() < completedAt.getTime()) {
      await this.intentRepo.expireLockedIntent(intent.id, tx);
      return { kind: 'expired' };
    }

    switch (intent.operation) {
      case 'create': {
        await this.entryAuthorizer.reauthorizeParentForCreate(
          {
            actorUserId: user.id,
            ownerId: user.id,
            parentId: intent.targetParentId,
          },
          tx,
        );

        const createResult = await this.intentRepo.completeCreateIntent(
          {
            intent,
            userId: user.id,
            completedAt,
          },
          tx,
        );

        if (createResult.kind === 'duplicate_entry_name') {
          return { kind: 'duplicate_entry_name' };
        }

        await this.auditRepo.record(
          {
            ownerId: user.id,
            actorUserId: user.id,
            entryId: createResult.file.entryId,
            entryNameSnapshot: createResult.file.name,
            action: 'file.uploaded',
            details: {
              contentType: createResult.file.contentType,
              sizeBytes: createResult.file.sizeBytes,
            },
            occurredAt: completedAt,
          },
          tx,
        );

        return { kind: 'completed', file: createResult.file };
      }

      case 'replace': {
        if (intent.targetFileId === null || intent.expectedContentVersion === null) {
          throw new Error('Replace intent is missing replacement metadata');
        }

        const { entry: target } = await this.entryAuthorizer.authorizeForUpdateByDbId(
          {
            actorUserId: user.id,
            entryDbId: intent.targetFileId,
            actions: ['file:replace'],
          },
          tx,
        );

        const replaceResult = await this.intentRepo.completeReplaceIntent(
          {
            intent,
            targetEntryId: target.id,
            completedAt,
          },
          tx,
        );

        if (replaceResult.kind === 'superseded') {
          return { kind: 'superseded' };
        }

        await this.auditRepo.record(
          {
            ownerId: target.ownerId,
            actorUserId: user.id,
            entryId: target.id,
            entryNameSnapshot: replaceResult.file.name,
            action: 'file.content_replaced',
            details: {
              previousContentVersion: replaceResult.previousContentVersion,
              newContentVersion: replaceResult.newContentVersion,
              contentType: replaceResult.file.contentType,
              sizeBytes: replaceResult.file.sizeBytes,
            },
            occurredAt: completedAt,
          },
          tx,
        );

        return { kind: 'completed', file: replaceResult.file };
      }
    }
  }

  private async createPresignedUploadUrl(upload: UploadIntentInput): Promise<string> {
    if (upload.expectedSha256 === null) {
      throw new Error('Single-part upload is missing expected SHA-256');
    }

    return this.storage.createPresignedUploadUrl({
      objectKey: upload.objectKey,
      contentType: upload.contentType,
      sizeBytes: upload.expectedSizeBytes,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      sha256Hex: upload.expectedSha256,
    });
  }

  private async getUploadedObject(intent: UploadIntent): Promise<ObjectMetadata> {
    try {
      return await this.storage.headObject(intent.objectKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new AppError('upload_object_missing', {
          cause: error,
          context: {
            uploadId: intent.uploadId,
            objectKey: intent.objectKey,
            storageOperation: error.context.operation,
          },
        });
      }

      throw error;
    }
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
    if (intent.expectedSha256 === null) {
      throw new Error('Single-part upload intent is missing expected SHA-256');
    }

    assertObjectKeyMatches(intent, object);
    assertChecksumExists(intent, object);
    assertChecksumMatches(intent, object, {
      type: 'full_sha256',
      value: intent.expectedSha256,
    });
    assertSizeMatches(intent, object);
    assertContentTypeMatches(intent, object);
  }

  private mapCompletionOutcome(outcome: CompleteUploadOutcome): FileResponse {
    switch (outcome.kind) {
      case 'completed':
        return {
          kind: 'file',
          id: outcome.file.publicId,
          name: outcome.file.name,
          contentType: outcome.file.contentType,
          sizeBytes: outcome.file.sizeBytes,
          updatedAt: outcome.file.updatedAt.toISOString(),
        };
      case 'not_found':
        throw new AppError('upload_not_found');
      case 'expired':
        throw new AppError('upload_expired');
      case 'aborted':
        throw new AppError('upload_aborted');
      case 'superseded':
        throw new AppError('replacement_conflict');
      case 'duplicate_entry_name':
        throw new AppError('duplicate_entry_name');
    }
  }

  private createUploadIntentInput(
    user: User,
    request: UploadRequestBody | ReplacementUploadRequestBody,
  ): UploadIntentInput {
    const createdAt = new Date();
    const uploadId = randomUUID();
    const objectId = randomUUID();

    return {
      uploadId,
      createdByUserId: user.id,
      objectKey: `users/${user.publicId}/objects/${objectId}`,
      contentType: request.contentType,
      expectedSizeBytes: request.size,
      expectedSha256: request.sha256,
      uploadMode: 'single',
      s3UploadId: null,
      partSizeBytes: null,
      partCount: null,
      checksumType: 'full_sha256',
      createdAt,
      uploadUrlExpiresAt: new Date(createdAt.getTime() + this.EXPIRES_IN_SECONDS * 1000),
      finalizeDeadline: new Date(createdAt.getTime() + this.FINALIZE_DEADLINE_SECONDS * 1000),
    };
  }

  private toUploadResponse(upload: UploadIntentInput, uploadUrl: string): UploadResponse {
    if (upload.expectedSha256 === null) {
      throw new Error('Single-part upload is missing expected SHA-256');
    }

    return {
      uploadId: upload.uploadId,
      uploadUrl,
      expiresInSeconds: this.EXPIRES_IN_SECONDS,
      requiredHeaders: {
        'Content-Type': upload.contentType,
        'x-amz-checksum-sha256': sha256HexToBase64(upload.expectedSha256),
      },
    };
  }
}
