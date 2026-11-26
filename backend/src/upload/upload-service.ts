import { randomUUID } from 'node:crypto';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { EntryAuthorizer } from '../authorization/entry-authorizer.js';
import type { TransactionContext, UnitOfWork } from '../db/unit-of-work.js';
import type { FileResponse } from '../files/dto.js';
import { AppError } from '../shared/errors/api/app-error.js';
import { StorageInvalidPartsError } from '../shared/errors/storage/storage-invalid-parts-error.js';
import { StorageObjectNotFoundError } from '../shared/errors/storage/storage-object-not-found-error.js';
import { computeCompositeSha256, sha256HexToBase64 } from '../shared/utils/sha256-convert.js';
import type {
  CompletedMultipartPart,
  ObjectChecksum,
  ObjectMetadata,
  ObjectStorage,
} from '../storage/object-storage.js';
import type { User } from '../user/user.js';
import type { PresignUploadPartsResponse, UploadResponse } from './dto.js';
import {
  assertChecksumExists,
  assertChecksumMatches,
  assertContentTypeMatches,
  assertObjectKeyMatches,
  assertSizeMatches,
} from './metadata-assertions.js';
import type { CompletedUploadFile, UploadIntentRepository } from './upload-intent-repository.js';
import type { UploadIntent, UploadIntentInput } from './upload-intent.js';
import { computeUploadPlan, getExpectedPartSizeBytes } from './upload-sizing.js';
import type {
  CompleteUploadRequestBody,
  PresignPartsRequestBody,
  ReplacementUploadRequestBody,
  UploadRequestBody,
} from './validation-schemas.js';

type CompleteUploadOutcome =
  | { kind: 'completed'; file: CompletedUploadFile }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'aborted' }
  | { kind: 'superseded' }
  | { kind: 'duplicate_entry_name' };

export class UploadService {
  private readonly SINGLE_PART_EXPIRES_IN_SECONDS = 600;
  private readonly SINGLE_PART_FINALIZE_DEADLINE_SECONDS = 60 * 60;
  private readonly MULTIPART_PART_EXPIRES_IN_SECONDS = 900;
  private readonly MULTIPART_FINALIZE_DEADLINE_SECONDS = 48 * 60 * 60;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly entryAuthorizer: EntryAuthorizer,
    private readonly storage: ObjectStorage,
    private readonly intentRepo: UploadIntentRepository,
    private readonly auditRepo: AuditRepository,
  ) {}

  async createUpload(user: User, requestBody: UploadRequestBody): Promise<UploadResponse> {
    const parentFolderId = requestBody.parentFolderId ?? null;
    const plan = computeUploadPlan(requestBody.size);

    if (plan.uploadMode === 'single') {
      const upload = this.createSinglePartIntentInput(user, requestBody);
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

      return this.toSinglePartUploadResponse(upload, uploadUrl);
    }

    const objectKey = this.createObjectKey(user);
    let createdS3UploadId: string | null = null;

    try {
      const upload = await this.unitOfWork.run(async (tx) => {
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

        const s3UploadId = await this.storage.createMultipartUpload({
          objectKey,
          contentType: requestBody.contentType,
        });
        createdS3UploadId = s3UploadId;

        const multipartIntent = this.createMultipartIntentInput(
          user,
          requestBody,
          objectKey,
          s3UploadId,
          plan.partSizeBytes,
          plan.partCount,
        );

        await this.intentRepo.save(
          {
            upload: multipartIntent,
            targetParentId,
            fileName: requestBody.fileName,
          },
          tx,
        );

        return multipartIntent;
      });

      return this.toMultipartUploadResponse(upload);
    } catch (error) {
      if (createdS3UploadId !== null) {
        await this.storage
          .abortMultipartUpload(objectKey, createdS3UploadId)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async createReplacementUpload(
    user: User,
    filePublicId: string,
    request: ReplacementUploadRequestBody,
  ): Promise<UploadResponse> {
    const plan = computeUploadPlan(request.size);

    if (plan.uploadMode === 'single') {
      const upload = this.createSinglePartIntentInput(user, request);
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

      return this.toSinglePartUploadResponse(upload, uploadUrl);
    }

    const objectKey = this.createObjectKey(user);
    let createdS3UploadId: string | null = null;

    try {
      const upload = await this.unitOfWork.run(async (tx) => {
        const { entry: target } = await this.entryAuthorizer.authorizeForUpdate(
          {
            actorUserId: user.id,
            entryPublicId: filePublicId,
            actions: ['file:replace'],
          },
          tx,
        );

        const s3UploadId = await this.storage.createMultipartUpload({
          objectKey,
          contentType: request.contentType,
        });
        createdS3UploadId = s3UploadId;

        const multipartIntent = this.createMultipartIntentInput(
          user,
          request,
          objectKey,
          s3UploadId,
          plan.partSizeBytes,
          plan.partCount,
        );

        await this.intentRepo.saveReplacement(
          {
            upload: multipartIntent,
            targetFileId: target.id,
          },
          tx,
        );

        return multipartIntent;
      });

      return this.toMultipartUploadResponse(upload);
    } catch (error) {
      if (createdS3UploadId !== null) {
        await this.storage
          .abortMultipartUpload(objectKey, createdS3UploadId)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async presignParts(
    user: User,
    uploadId: string,
    request: PresignPartsRequestBody,
  ): Promise<PresignUploadPartsResponse> {
    const intent = await this.getUploadIntent(user.id, uploadId);

    if (intent.uploadMode !== 'multipart') {
      throw new AppError('upload_mode_mismatch');
    }

    switch (intent.status) {
      case 'completed':
        throw new AppError('upload_already_completed');
      case 'expired':
        throw new AppError('upload_expired');
      case 'aborted':
        throw new AppError('upload_aborted');
      case 'superseded':
        throw new AppError(
          intent.operation === 'create' ? 'duplicate_entry_name' : 'replacement_conflict',
        );
      case 'pending':
        break;
    }

    const now = new Date();
    if (intent.finalizeDeadline.getTime() <= now.getTime()) {
      await this.expireIntentIfPending(user.id, intent.uploadId);
      throw new AppError('upload_expired');
    }

    if (intent.s3UploadId === null || intent.partSizeBytes === null || intent.partCount === null) {
      throw new Error('Multipart upload intent is missing multipart metadata');
    }

    const s3UploadId = intent.s3UploadId;
    const partSizeBytes = intent.partSizeBytes;
    const partCount = intent.partCount;

    for (const part of request.parts) {
      if (part.partNumber > partCount) {
        throw new AppError('upload_parts_invalid', {
          context: {
            uploadId: intent.uploadId,
            partNumber: part.partNumber,
            partCount,
          },
        });
      }
    }

    const remainingSeconds = Math.floor((intent.finalizeDeadline.getTime() - now.getTime()) / 1000);
    const expiresInSeconds = Math.min(
      this.MULTIPART_PART_EXPIRES_IN_SECONDS,
      Math.max(1, remainingSeconds),
    );

    const parts = await Promise.all(
      request.parts.map(async (part) => {
        const expectedSizeBytes = getExpectedPartSizeBytes(
          intent.expectedSizeBytes,
          partSizeBytes,
          partCount,
          part.partNumber,
        );
        const uploadUrl = await this.storage.createPresignedUploadPartUrl({
          objectKey: intent.objectKey,
          s3UploadId,
          partNumber: part.partNumber,
          sizeBytes: expectedSizeBytes,
          expiresInSeconds,
          sha256Hex: part.sha256,
        });

        return {
          partNumber: part.partNumber,
          uploadUrl,
          expiresInSeconds,
          requiredHeaders: {
            'x-amz-checksum-sha256': sha256HexToBase64(part.sha256),
          },
        };
      }),
    );

    return {
      uploadId: intent.uploadId,
      parts,
    };
  }

  async completeUpload(
    user: User,
    uploadId: string,
    request?: CompleteUploadRequestBody,
  ): Promise<FileResponse> {
    const intent = await this.getUploadIntent(user.id, uploadId);
    const checkTime = new Date();
    let verifiedChecksum: ObjectChecksum | null = null;

    if (this.shouldVerifyUploadedObject(intent, checkTime)) {
      verifiedChecksum = await this.verifyAndFinalizeStorageObject(intent, request);
    }

    const completedAt = new Date(Math.max(Date.now(), checkTime.getTime()));
    const outcome = await this.unitOfWork.run((tx) =>
      this.completeUploadInTransaction(user, intent.uploadId, verifiedChecksum, completedAt, tx),
    );

    return this.mapCompletionOutcome(outcome);
  }

  async abortUpload(user: User, uploadId: string): Promise<void> {
    const abortTarget = await this.unitOfWork.run(async (tx) => {
      const lockedIntent = await this.intentRepo.findByUserAndUploadIdForUpdate(
        user.id,
        uploadId,
        tx,
      );

      if (!lockedIntent) {
        throw new AppError('upload_not_found');
      }

      if (lockedIntent.status === 'completed') {
        throw new AppError('upload_already_completed');
      }

      if (lockedIntent.status !== 'pending') {
        return null;
      }

      await this.intentRepo.abortLockedIntent(lockedIntent.id, tx);

      return lockedIntent.s3UploadId !== null
        ? { objectKey: lockedIntent.objectKey, s3UploadId: lockedIntent.s3UploadId }
        : null;
    });

    if (abortTarget !== null) {
      await this.storage
        .abortMultipartUpload(abortTarget.objectKey, abortTarget.s3UploadId)
        .catch(() => undefined);
    }
  }

  private async verifyAndFinalizeStorageObject(
    intent: UploadIntent,
    request?: CompleteUploadRequestBody,
  ): Promise<ObjectChecksum> {
    if (intent.uploadMode === 'single') {
      if (request?.parts !== undefined) {
        throw new AppError('upload_parts_invalid', {
          context: { uploadId: intent.uploadId },
        });
      }

      if (intent.expectedSha256 === null) {
        throw new Error('Single-part upload intent is missing expected SHA-256');
      }

      const expectedChecksum: ObjectChecksum = {
        type: 'full_sha256',
        value: intent.expectedSha256,
      };
      const uploadedObject = await this.getUploadedObject(intent);
      this.verifyUpload(intent, uploadedObject, expectedChecksum);

      return expectedChecksum;
    }

    const sortedParts = this.validateAndSortCompletedParts(intent, request?.parts);
    const expectedCompositeChecksum = computeCompositeSha256(
      sortedParts.map((part) => part.sha256Hex),
    );

    if (intent.s3UploadId === null) {
      throw new Error('Multipart upload intent is missing s3UploadId');
    }

    try {
      await this.storage.completeMultipartUpload({
        objectKey: intent.objectKey,
        s3UploadId: intent.s3UploadId,
        parts: sortedParts,
      });
    } catch (error) {
      if (error instanceof StorageInvalidPartsError) {
        throw new AppError('upload_parts_invalid', {
          cause: error,
          context: {
            uploadId: intent.uploadId,
            objectKey: intent.objectKey,
            storageOperation: error.context.operation,
          },
        });
      }

      if (!(error instanceof StorageObjectNotFoundError)) {
        throw error;
      }
      // NoSuchUpload may happen on an idempotent retry after S3 completed but before DB commit;
      // fall through to headObject verification which throws upload_object_missing if absent.
    }

    const expectedChecksum: ObjectChecksum = {
      type: 'composite_sha256',
      value: expectedCompositeChecksum,
    };
    const uploadedObject = await this.getUploadedObject(intent);
    this.verifyUpload(intent, uploadedObject, expectedChecksum);

    return expectedChecksum;
  }

  private validateAndSortCompletedParts(
    intent: UploadIntent,
    parts: CompleteUploadRequestBody['parts'],
  ): CompletedMultipartPart[] {
    if (intent.partCount === null) {
      throw new Error('Multipart upload intent is missing partCount');
    }

    if (!parts || parts.length !== intent.partCount) {
      throw new AppError('upload_parts_invalid', {
        context: {
          uploadId: intent.uploadId,
          expectedPartCount: intent.partCount,
          actualPartCount: parts?.length ?? 0,
        },
      });
    }

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    for (let index = 0; index < sorted.length; index++) {
      if (sorted[index]!.partNumber !== index + 1) {
        throw new AppError('upload_parts_invalid', {
          context: {
            uploadId: intent.uploadId,
            expectedPartNumber: index + 1,
            actualPartNumber: sorted[index]!.partNumber,
          },
        });
      }
    }

    return sorted.map((part) => ({
      partNumber: part.partNumber,
      etag: part.etag,
      sha256Hex: part.sha256,
    }));
  }

  private async expireIntentIfPending(userId: number, uploadId: string): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      const locked = await this.intentRepo.findByUserAndUploadIdForUpdate(userId, uploadId, tx);
      if (locked && locked.status === 'pending') {
        await this.intentRepo.expireLockedIntent(locked.id, tx);
      }
    });
  }

  private async completeUploadInTransaction(
    user: User,
    uploadId: string,
    verifiedChecksum: ObjectChecksum | null,
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
        return this.completePendingIntentInTransaction(
          user,
          lockedIntent,
          verifiedChecksum,
          completedAt,
          tx,
        );
    }
  }

  private async completePendingIntentInTransaction(
    user: User,
    intent: UploadIntent,
    verifiedChecksum: ObjectChecksum | null,
    completedAt: Date,
    tx: TransactionContext,
  ): Promise<CompleteUploadOutcome> {
    if (intent.finalizeDeadline.getTime() <= completedAt.getTime()) {
      await this.intentRepo.expireLockedIntent(intent.id, tx);
      return { kind: 'expired' };
    }

    if (verifiedChecksum === null) {
      throw new Error('Pending upload completion is missing verified checksum');
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
            verifiedChecksum,
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
            verifiedChecksum,
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
      expiresInSeconds: this.SINGLE_PART_EXPIRES_IN_SECONDS,
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

  private shouldVerifyUploadedObject(intent: UploadIntent, now: Date): boolean {
    return intent.status === 'pending' && intent.finalizeDeadline.getTime() > now.getTime();
  }

  private verifyUpload(
    intent: UploadIntent,
    object: ObjectMetadata,
    expectedChecksum: ObjectChecksum,
  ): void {
    assertObjectKeyMatches(intent, object);
    assertChecksumExists(intent, object);
    assertChecksumMatches(intent, object, expectedChecksum);
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

  private createObjectKey(user: User): string {
    return `users/${user.publicId}/objects/${randomUUID()}`;
  }

  private createSinglePartIntentInput(
    user: User,
    request: UploadRequestBody | ReplacementUploadRequestBody,
  ): UploadIntentInput {
    if (request.sha256 === undefined) {
      throw new Error('Single-part upload request is missing SHA-256');
    }

    const createdAt = new Date();

    return {
      uploadId: randomUUID(),
      createdByUserId: user.id,
      objectKey: this.createObjectKey(user),
      contentType: request.contentType,
      expectedSizeBytes: request.size,
      expectedSha256: request.sha256,
      uploadMode: 'single',
      s3UploadId: null,
      partSizeBytes: null,
      partCount: null,
      checksumType: 'full_sha256',
      createdAt,
      uploadUrlExpiresAt: new Date(
        createdAt.getTime() + this.SINGLE_PART_EXPIRES_IN_SECONDS * 1000,
      ),
      finalizeDeadline: new Date(
        createdAt.getTime() + this.SINGLE_PART_FINALIZE_DEADLINE_SECONDS * 1000,
      ),
    };
  }

  private createMultipartIntentInput(
    user: User,
    request: UploadRequestBody | ReplacementUploadRequestBody,
    objectKey: string,
    s3UploadId: string,
    partSizeBytes: number,
    partCount: number,
  ): UploadIntentInput {
    const createdAt = new Date();

    return {
      uploadId: randomUUID(),
      createdByUserId: user.id,
      objectKey,
      contentType: request.contentType,
      expectedSizeBytes: request.size,
      expectedSha256: null,
      uploadMode: 'multipart',
      s3UploadId,
      partSizeBytes,
      partCount,
      checksumType: 'composite_sha256',
      createdAt,
      uploadUrlExpiresAt: null,
      finalizeDeadline: new Date(
        createdAt.getTime() + this.MULTIPART_FINALIZE_DEADLINE_SECONDS * 1000,
      ),
    };
  }

  private toSinglePartUploadResponse(upload: UploadIntentInput, uploadUrl: string): UploadResponse {
    if (upload.expectedSha256 === null) {
      throw new Error('Single-part upload is missing expected SHA-256');
    }

    return {
      uploadMode: 'single',
      uploadId: upload.uploadId,
      uploadUrl,
      expiresInSeconds: this.SINGLE_PART_EXPIRES_IN_SECONDS,
      requiredHeaders: {
        'Content-Type': upload.contentType,
        'x-amz-checksum-sha256': sha256HexToBase64(upload.expectedSha256),
      },
    };
  }

  private toMultipartUploadResponse(upload: UploadIntentInput): UploadResponse {
    if (upload.partSizeBytes === null || upload.partCount === null) {
      throw new Error('Multipart upload is missing part plan');
    }

    return {
      uploadMode: 'multipart',
      uploadId: upload.uploadId,
      partSizeBytes: upload.partSizeBytes,
      partCount: upload.partCount,
      finalizeDeadline: upload.finalizeDeadline.toISOString(),
    };
  }
}
