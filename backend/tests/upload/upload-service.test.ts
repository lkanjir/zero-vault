import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuditRepository } from '../../src/audit/audit-repository.js';
import type { AuthorizedEntry, EntryAuthorizer } from '../../src/authorization/entry-authorizer.js';
import type { TransactionContext, UnitOfWork } from '../../src/db/unit-of-work.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import { StorageInvalidPartsError } from '../../src/shared/errors/storage/storage-invalid-parts-error.js';
import { StorageObjectNotFoundError } from '../../src/shared/errors/storage/storage-object-not-found-error.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import { computeCompositeSha256 } from '../../src/shared/utils/sha256-convert.js';
import type { ObjectMetadata, ObjectStorage } from '../../src/storage/object-storage.js';
import type {
  CompletedUploadFile,
  UploadIntentRepository,
} from '../../src/upload/upload-intent-repository.js';
import type { UploadIntent } from '../../src/upload/upload-intent.js';
import { UploadService } from '../../src/upload/upload-service.js';
import {
  MULTIPART_STANDARD_PART_SIZE_BYTES,
  SINGLE_PART_MAX_BYTES,
} from '../../src/upload/upload-sizing.js';
import type { User } from '../../src/user/user.js';
import { createFakeUnitOfWork } from '../helpers/fake-unit-of-work.js';

const EXPECTED_SHA256 = 'a'.repeat(64);
const EXPECTED_SHA256_BASE64 = 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=';
const OTHER_SHA256 = 'b'.repeat(64);
const SIGNED_URL = 'https://storage.example.test/upload';
const NOW = new Date('2026-08-08T11:00:00.000Z');

const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

describe('UploadService', () => {
  let tx: TransactionContext;
  let unitOfWork: UnitOfWork;
  let entryAuthorizer: MockProxy<EntryAuthorizer>;
  let storage: MockProxy<ObjectStorage>;
  let repo: MockProxy<UploadIntentRepository>;
  let auditRepo: MockProxy<AuditRepository>;
  let service: UploadService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ({ tx, unitOfWork } = createFakeUnitOfWork());
    entryAuthorizer = mock<EntryAuthorizer>();
    storage = mock<ObjectStorage>();
    repo = mock<UploadIntentRepository>();
    auditRepo = mock<AuditRepository>();
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(null);
    entryAuthorizer.authorizeForUpdate.mockResolvedValue(makeAuthorizedFile(10));
    entryAuthorizer.authorizeForUpdateByDbId.mockResolvedValue(makeAuthorizedFile(10));
    service = new UploadService(unitOfWork, entryAuthorizer, storage, repo, auditRepo);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a pending upload intent and returns required upload headers', async () => {
    storage.createPresignedUploadUrl.mockResolvedValue(SIGNED_URL);
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(7);

    const parentFolderId = '0e3a99c9-efc6-4302-8e50-02df497bab88';

    const result = await service.createUpload(USER, {
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
      parentFolderId,
    });

    expect(result).toStrictEqual({
      uploadMode: 'single',
      uploadId: result.uploadId,
      uploadUrl: SIGNED_URL,
      expiresInSeconds: 600,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': EXPECTED_SHA256_BASE64,
      },
    });

    expect(entryAuthorizer.authorizeParentForCreate).toHaveBeenCalledOnce();
    expect(repo.assertUploadTargetAvailable).toHaveBeenCalledExactlyOnceWith(
      {
        userId: USER.id,
        targetParentId: 7,
        fileName: 'document.txt',
      },
      tx,
    );

    expect(storage.createPresignedUploadUrl).toHaveBeenCalledOnce();
    const [signedRequest] = storage.createPresignedUploadUrl.mock.lastCall!;
    expect(signedRequest.objectKey).toMatch(
      new RegExp(`^users/${USER.publicId}/objects/[0-9a-f-]{36}$`),
    );
    expect(signedRequest).toStrictEqual({
      objectKey: signedRequest.objectKey,
      contentType: 'text/plain',
      sizeBytes: 12,
      expiresInSeconds: 600,
      sha256Hex: EXPECTED_SHA256,
    });

    expect(repo.save).toHaveBeenCalledOnce();
    const [savedCommand, savedTx] = repo.save.mock.lastCall!;
    expect(savedCommand).toMatchObject({
      upload: {
        uploadId: result.uploadId,
        createdByUserId: USER.id,
        contentType: 'text/plain',
        expectedSizeBytes: 12,
        expectedSha256: EXPECTED_SHA256,
        uploadUrlExpiresAt: new Date(NOW.getTime() + 600_000),
        finalizeDeadline: new Date(NOW.getTime() + 3_600_000),
      },
      fileName: 'document.txt',
      targetParentId: 7,
    });
    expect(savedTx).toBe(tx);
  });

  it('given empty parentFolderId creates pending upload intent for root', async () => {
    storage.createPresignedUploadUrl.mockResolvedValue(SIGNED_URL);

    await service.createUpload(USER, {
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    expect(repo.save).toHaveBeenCalledOnce();
    expect(repo.save.mock.lastCall![0]).toMatchObject({
      targetParentId: null,
    });
  });

  it('does not presign or save an upload when the target name already exists', async () => {
    const parentFolderId = '0e3a99c9-efc6-4302-8e50-02df497bab88';
    const duplicateError = new AppError('duplicate_entry_name');
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(7);
    repo.assertUploadTargetAvailable.mockRejectedValue(duplicateError);

    await expect(
      service.createUpload(USER, {
        fileName: 'document.txt',
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
        parentFolderId,
      }),
    ).rejects.toBe(duplicateError);

    expect(repo.assertUploadTargetAvailable).toHaveBeenCalledExactlyOnceWith(
      {
        userId: USER.id,
        targetParentId: 7,
        fileName: 'document.txt',
      },
      tx,
    );
    expect(storage.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('creates a replacement intent and returns required upload headers', async () => {
    storage.createPresignedUploadUrl.mockResolvedValue(SIGNED_URL);
    const filePublicId = '20000000-0000-4000-8000-000000000001';

    const result = await service.createReplacementUpload(USER, filePublicId, {
      contentType: 'application/pdf',
      size: 24,
      sha256: EXPECTED_SHA256,
    });

    expect(entryAuthorizer.authorizeForUpdate).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        entryPublicId: filePublicId,
        actions: ['file:replace'],
      },
      tx,
    );
    expect(storage.createPresignedUploadUrl).toHaveBeenCalledOnce();
    expect(storage.createPresignedUploadUrl.mock.lastCall![0]).toMatchObject({
      contentType: 'application/pdf',
      sizeBytes: 24,
      expiresInSeconds: 600,
      sha256Hex: EXPECTED_SHA256,
    });
    expect(repo.saveReplacement).toHaveBeenCalledOnce();
    const [savedReplacement, savedTx] = repo.saveReplacement.mock.lastCall!;
    expect(savedReplacement).toMatchObject({
      targetFileId: 10,
      upload: {
        uploadId: result.uploadId,
        createdByUserId: USER.id,
        contentType: 'application/pdf',
        expectedSizeBytes: 24,
        expectedSha256: EXPECTED_SHA256,
      },
    });
    expect(savedTx).toBe(tx);
    expect(result).toStrictEqual({
      uploadMode: 'single',
      uploadId: result.uploadId,
      uploadUrl: SIGNED_URL,
      expiresInSeconds: 600,
      requiredHeaders: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-sha256': EXPECTED_SHA256_BASE64,
      },
    });
  });

  it('does not presign or save a replacement when fail-fast authorization rejects it', async () => {
    const filePublicId = '20000000-0000-4000-8000-000000000001';
    const authorizationError = new AppError('entry_not_found');
    entryAuthorizer.authorizeForUpdate.mockRejectedValue(authorizationError);

    await expect(
      service.createReplacementUpload(USER, filePublicId, {
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
      }),
    ).rejects.toBe(authorizationError);

    expect(storage.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(repo.saveReplacement).not.toHaveBeenCalled();
  });

  it('verifies the uploaded object, completes a pending create upload, records audit, and maps FileResponse', async () => {
    const intent = makePendingIntent();
    const completedFile = makeCompletedFile();

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeCreateIntent.mockResolvedValue({ kind: 'completed', file: completedFile });

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result).toStrictEqual({
      kind: 'file',
      id: completedFile.publicId,
      name: completedFile.name,
      contentType: completedFile.contentType,
      sizeBytes: completedFile.sizeBytes,
      updatedAt: completedFile.updatedAt.toISOString(),
    });
    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(intent.objectKey);
    expect(entryAuthorizer.reauthorizeParentForCreate).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        ownerId: USER.id,
        parentId: intent.targetParentId,
      },
      tx,
    );
    expect(repo.completeCreateIntent).toHaveBeenCalledExactlyOnceWith(
      {
        intent,
        userId: USER.id,
        verifiedChecksum: {
          type: 'full_sha256',
          value: EXPECTED_SHA256,
        },
        completedAt: NOW,
      },
      tx,
    );
    expect(auditRepo.record).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: completedFile.entryId,
        entryNameSnapshot: completedFile.name,
        action: 'file.uploaded',
        details: {
          contentType: completedFile.contentType,
          sizeBytes: completedFile.sizeBytes,
        },
        occurredAt: NOW,
      },
      tx,
    );
  });

  it('completes a pending replacement upload and records file.content_replaced audit', async () => {
    const intent = makePendingIntent({
      operation: 'replace',
      fileName: null,
      targetFileId: 10,
      expectedContentVersion: 1,
    });
    const completedFile = makeCompletedFile({ sizeBytes: 24, contentType: 'application/pdf' });
    entryAuthorizer.authorizeForUpdateByDbId.mockResolvedValue(makeAuthorizedFile(10, 99));
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeReplaceIntent.mockResolvedValue({
      kind: 'completed',
      file: completedFile,
      previousContentVersion: 1,
      newContentVersion: 2,
    });

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result).toStrictEqual({
      kind: 'file',
      id: completedFile.publicId,
      name: completedFile.name,
      contentType: 'application/pdf',
      sizeBytes: 24,
      updatedAt: completedFile.updatedAt.toISOString(),
    });
    expect(entryAuthorizer.authorizeForUpdateByDbId).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        entryDbId: 10,
        actions: ['file:replace'],
      },
      tx,
    );
    expect(auditRepo.record).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: 99,
        actorUserId: USER.id,
        entryId: 10,
        entryNameSnapshot: completedFile.name,
        action: 'file.content_replaced',
        details: {
          previousContentVersion: 1,
          newContentVersion: 2,
          contentType: 'application/pdf',
          sizeBytes: 24,
        },
        occurredAt: NOW,
      },
      tx,
    );
  });

  it('returns an already completed upload without reading object storage or re-auditing', async () => {
    const intent = makeCompletedIntent();
    const completedFile = makeCompletedFile();

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    repo.findCompletedFileByIntentId.mockResolvedValue(completedFile);

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result).toStrictEqual({
      kind: 'file',
      id: completedFile.publicId,
      name: completedFile.name,
      contentType: completedFile.contentType,
      sizeBytes: completedFile.sizeBytes,
      updatedAt: completedFile.updatedAt.toISOString(),
    });
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(auditRepo.record).not.toHaveBeenCalled();
  });

  it.each([
    ['missing provider checksum', { checksum: null }, 'upload_checksum_missing', {}],
    [
      'checksum mismatch',
      { checksum: { type: 'full_sha256' as const, value: OTHER_SHA256 } },
      'upload_checksum_mismatch',
      {
        objectChecksumType: 'full_sha256',
        objectHash: OTHER_SHA256,
        intentChecksumType: 'full_sha256',
        intentHash: EXPECTED_SHA256,
      },
    ],
    [
      'size mismatch',
      { sizeBytes: 99 },
      'upload_size_mismatch',
      { objectSize: 99, intentSize: 12 },
    ],
    [
      'content type mismatch',
      { contentType: 'application/pdf' },
      'upload_content_type_mismatch',
      { objectContentType: 'application/pdf', intentContentType: 'text/plain' },
    ],
  ] as const)(
    'rejects an uploaded object with %s',
    async (_case, metadataOverrides, code, expectedContext) => {
      const intent = makePendingIntent();

      repo.findByUserAndUploadId.mockResolvedValue(intent);
      storage.headObject.mockResolvedValue(makeObjectMetadata(intent, metadataOverrides));

      await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
        code,
        options: {
          context: {
            uploadId: intent.uploadId,
            objectKey: intent.objectKey,
            ...expectedContext,
          },
        },
      });
      expect(repo.findByUserAndUploadIdForUpdate).not.toHaveBeenCalled();
    },
  );

  it('expires stale pending intents before reading object storage', async () => {
    const intent = makePendingIntent({
      finalizeDeadline: new Date(NOW.getTime() - 1_000),
    });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_expired',
    });

    expect(storage.headObject).not.toHaveBeenCalled();
    expect(repo.expireLockedIntent).toHaveBeenCalledExactlyOnceWith(intent.id, tx);
  });

  it('reports expired if intent is already expired when locked for completion', async () => {
    const intent = makePendingIntent({
      finalizeDeadline: new Date(NOW.getTime() + 60_000),
    });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue({ ...intent, status: 'expired' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_expired',
    });

    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(intent.objectKey);
    expect(repo.completeCreateIntent).not.toHaveBeenCalled();
  });

  it('does not allow another user to complete the upload', async () => {
    repo.findByUserAndUploadId.mockResolvedValue(null);

    await expect(service.completeUpload({ ...USER, id: 2 }, 'upload-id')).rejects.toMatchObject({
      code: 'upload_not_found',
    });
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(repo.findByUserAndUploadIdForUpdate).not.toHaveBeenCalled();
  });

  it('propagates upload presign storage failure and does not save intent', async () => {
    const storageError = new StorageUnavailableError(
      { operation: 'create_upload_url', objectKey: 'object-key' },
      { cause: new Error('S3 unavailable') },
    );
    storage.createPresignedUploadUrl.mockRejectedValue(storageError);

    await expect(
      service.createUpload(USER, {
        fileName: 'document.txt',
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
      }),
    ).rejects.toBe(storageError);

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('maps a missing uploaded object to upload_object_missing', async () => {
    const intent = makePendingIntent();
    const storageError = new StorageObjectNotFoundError(
      { operation: 'head_object', objectKey: intent.objectKey },
      { cause: new Error('S3 404') },
    );
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockRejectedValue(storageError);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_object_missing',
      options: {
        cause: storageError,
        context: {
          uploadId: intent.uploadId,
          objectKey: intent.objectKey,
          storageOperation: 'head_object',
        },
      },
    });
    expect(repo.findByUserAndUploadIdForUpdate).not.toHaveBeenCalled();
  });

  it('propagates a head request storage failure without completing the upload', async () => {
    const intent = makePendingIntent();
    const storageError = new StorageUnavailableError(
      { operation: 'head_object', objectKey: intent.objectKey },
      { cause: new Error('S3 unavailable') },
    );
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockRejectedValue(storageError);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toBe(storageError);
    expect(repo.findByUserAndUploadIdForUpdate).not.toHaveBeenCalled();
  });

  it('maps a repository completion race to upload_not_found', async () => {
    const intent = makePendingIntent();
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(null);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_not_found',
    });
  });

  it('maps a superseded replacement completion to replacement_conflict without auditing', async () => {
    const intent = makePendingIntent({
      operation: 'replace',
      fileName: null,
      targetFileId: 10,
      expectedContentVersion: 1,
    });
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeReplaceIntent.mockResolvedValue({ kind: 'superseded' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'replacement_conflict',
    });

    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(intent.objectKey);
    expect(auditRepo.record).not.toHaveBeenCalled();
  });

  it('returns replacement_conflict for an already superseded intent without reading storage', async () => {
    const intent = makePendingIntent({
      operation: 'replace',
      status: 'superseded',
      fileName: null,
      targetFileId: 10,
      expectedContentVersion: 1,
    });
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'replacement_conflict',
    });

    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it('maps a duplicate create completion outcome to duplicate_entry_name without auditing', async () => {
    const intent = makePendingIntent();
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeCreateIntent.mockResolvedValue({ kind: 'duplicate_entry_name' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'duplicate_entry_name',
    });

    expect(auditRepo.record).not.toHaveBeenCalled();
  });

  it('returns duplicate_entry_name for an already superseded create intent without reading storage', async () => {
    const intent = makePendingIntent({
      operation: 'create',
      status: 'superseded',
    });
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'duplicate_entry_name',
    });

    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it('creates a single-part upload intent for a 0-byte empty file', async () => {
    storage.createPresignedUploadUrl.mockResolvedValue(SIGNED_URL);

    const result = await service.createUpload(USER, {
      fileName: 'empty.txt',
      contentType: 'text/plain',
      size: 0,
      sha256: EXPECTED_SHA256,
    });

    expect(result).toMatchObject({
      uploadMode: 'single',
      uploadUrl: SIGNED_URL,
    });
    expect(storage.createPresignedUploadUrl.mock.lastCall![0]).toMatchObject({
      sizeBytes: 0,
      sha256Hex: EXPECTED_SHA256,
    });
  });

  it('creates a multipart upload intent for files larger than 16 MiB', async () => {
    storage.createMultipartUpload.mockResolvedValue('s3-upload-id-1');
    const size = SINGLE_PART_MAX_BYTES + 123;

    const result = await service.createUpload(USER, {
      fileName: 'archive.tar',
      contentType: 'application/x-tar',
      size,
    });

    expect(result).toStrictEqual({
      uploadMode: 'multipart',
      uploadId: result.uploadId,
      partSizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
      partCount: 2,
      finalizeDeadline: new Date(NOW.getTime() + 48 * 60 * 60_000).toISOString(),
    });
    expect(storage.createMultipartUpload).toHaveBeenCalledOnce();
    expect(storage.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledOnce();
    expect(repo.save.mock.lastCall![0]).toMatchObject({
      fileName: 'archive.tar',
      upload: {
        uploadMode: 'multipart',
        s3UploadId: 's3-upload-id-1',
        partSizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
        partCount: 2,
        expectedSha256: null,
        checksumType: 'composite_sha256',
        uploadUrlExpiresAt: null,
        finalizeDeadline: new Date(NOW.getTime() + 48 * 60 * 60_000),
      },
    });
  });

  it('aborts the newly created S3 multipart upload if saving the intent fails', async () => {
    storage.createMultipartUpload.mockResolvedValue('s3-upload-orphan');
    storage.abortMultipartUpload.mockResolvedValue();
    repo.save.mockRejectedValue(new Error('db write failed'));

    await expect(
      service.createUpload(USER, {
        fileName: 'archive.tar',
        contentType: 'application/x-tar',
        size: SINGLE_PART_MAX_BYTES + 1,
      }),
    ).rejects.toThrow('db write failed');

    expect(storage.abortMultipartUpload).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(new RegExp(`^users/${USER.publicId}/objects/[0-9a-f-]{36}$`)),
      's3-upload-orphan',
    );
  });

  it('creates a multipart replacement intent for files larger than 16 MiB', async () => {
    storage.createMultipartUpload.mockResolvedValue('s3-replace-upload-1');
    const filePublicId = '20000000-0000-4000-8000-000000000001';

    const result = await service.createReplacementUpload(USER, filePublicId, {
      contentType: 'application/octet-stream',
      size: SINGLE_PART_MAX_BYTES + 50,
    });

    expect(result).toStrictEqual({
      uploadMode: 'multipart',
      uploadId: result.uploadId,
      partSizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
      partCount: 2,
      finalizeDeadline: new Date(NOW.getTime() + 48 * 60 * 60_000).toISOString(),
    });
    expect(repo.saveReplacement).toHaveBeenCalledOnce();
    expect(repo.saveReplacement.mock.lastCall![0]).toMatchObject({
      targetFileId: 10,
      upload: {
        uploadMode: 'multipart',
        s3UploadId: 's3-replace-upload-1',
        partSizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
        partCount: 2,
      },
    });
  });

  it('presigns a batch of multipart parts with exact expected part sizes and deadline cap', async () => {
    const intent = makePendingMultipartIntent({
      expectedSizeBytes: SINGLE_PART_MAX_BYTES + 512,
      finalizeDeadline: new Date(NOW.getTime() + 300_000),
    });
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.createPresignedUploadPartUrl
      .mockResolvedValueOnce('https://storage.example.test/part-1')
      .mockResolvedValueOnce('https://storage.example.test/part-2');

    const result = await service.presignParts(USER, intent.uploadId, {
      parts: [
        { partNumber: 1, sha256: EXPECTED_SHA256 },
        { partNumber: 2, sha256: OTHER_SHA256 },
      ],
    });

    expect(result).toStrictEqual({
      uploadId: intent.uploadId,
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://storage.example.test/part-1',
          expiresInSeconds: 300,
          requiredHeaders: {
            'x-amz-checksum-sha256': EXPECTED_SHA256_BASE64,
          },
        },
        {
          partNumber: 2,
          uploadUrl: 'https://storage.example.test/part-2',
          expiresInSeconds: 300,
          requiredHeaders: {
            'x-amz-checksum-sha256': Buffer.from(OTHER_SHA256, 'hex').toString('base64'),
          },
        },
      ],
    });
    expect(storage.createPresignedUploadPartUrl).toHaveBeenNthCalledWith(1, {
      objectKey: intent.objectKey,
      s3UploadId: intent.s3UploadId,
      partNumber: 1,
      sizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
      expiresInSeconds: 300,
      sha256Hex: EXPECTED_SHA256,
    });
    expect(storage.createPresignedUploadPartUrl).toHaveBeenNthCalledWith(2, {
      objectKey: intent.objectKey,
      s3UploadId: intent.s3UploadId,
      partNumber: 2,
      sizeBytes: 512,
      expiresInSeconds: 300,
      sha256Hex: OTHER_SHA256,
    });
  });

  it('rejects presignParts for single-part, out-of-range, aborted, or expired intents', async () => {
    repo.findByUserAndUploadId.mockResolvedValueOnce(makePendingIntent());
    await expect(
      service.presignParts(USER, 'upload-1', {
        parts: [{ partNumber: 1, sha256: EXPECTED_SHA256 }],
      }),
    ).rejects.toMatchObject({ code: 'upload_mode_mismatch' });

    repo.findByUserAndUploadId.mockResolvedValueOnce(makePendingMultipartIntent({ partCount: 2 }));
    await expect(
      service.presignParts(USER, 'upload-1', {
        parts: [{ partNumber: 3, sha256: EXPECTED_SHA256 }],
      }),
    ).rejects.toMatchObject({ code: 'upload_parts_invalid' });

    repo.findByUserAndUploadId.mockResolvedValueOnce(
      makePendingMultipartIntent({ status: 'aborted' }),
    );
    await expect(
      service.presignParts(USER, 'upload-1', {
        parts: [{ partNumber: 1, sha256: EXPECTED_SHA256 }],
      }),
    ).rejects.toMatchObject({ code: 'upload_aborted' });

    const expiredIntent = makePendingMultipartIntent({
      finalizeDeadline: new Date(NOW.getTime() - 1_000),
    });
    repo.findByUserAndUploadId.mockResolvedValueOnce(expiredIntent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValueOnce(expiredIntent);
    await expect(
      service.presignParts(USER, expiredIntent.uploadId, {
        parts: [{ partNumber: 1, sha256: EXPECTED_SHA256 }],
      }),
    ).rejects.toMatchObject({ code: 'upload_expired' });
    expect(repo.expireLockedIntent).toHaveBeenCalledExactlyOnceWith(expiredIntent.id, tx);
  });

  it('completes a multipart upload, verifies composite checksum, and persists composite_sha256', async () => {
    const intent = makePendingMultipartIntent();
    const expectedComposite = computeCompositeSha256([EXPECTED_SHA256, OTHER_SHA256]);
    const completedFile = makeCompletedFile({ sizeBytes: intent.expectedSizeBytes });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    storage.completeMultipartUpload.mockResolvedValue({ compositeChecksum: expectedComposite });
    storage.headObject.mockResolvedValue({
      objectKey: intent.objectKey,
      sizeBytes: intent.expectedSizeBytes,
      contentType: intent.contentType,
      checksum: { type: 'composite_sha256', value: expectedComposite },
    });
    repo.completeCreateIntent.mockResolvedValue({ kind: 'completed', file: completedFile });

    // Pass parts out of order to verify sorting
    const result = await service.completeUpload(USER, intent.uploadId, {
      parts: [
        { partNumber: 2, etag: '"etag-2"', sha256: OTHER_SHA256 },
        { partNumber: 1, etag: '"etag-1"', sha256: EXPECTED_SHA256 },
      ],
    });

    expect(result.sizeBytes).toBe(intent.expectedSizeBytes);
    expect(storage.completeMultipartUpload).toHaveBeenCalledExactlyOnceWith({
      objectKey: intent.objectKey,
      s3UploadId: intent.s3UploadId,
      parts: [
        { partNumber: 1, etag: '"etag-1"', sha256Hex: EXPECTED_SHA256 },
        { partNumber: 2, etag: '"etag-2"', sha256Hex: OTHER_SHA256 },
      ],
    });
    expect(repo.completeCreateIntent).toHaveBeenCalledExactlyOnceWith(
      {
        intent,
        userId: USER.id,
        verifiedChecksum: {
          type: 'composite_sha256',
          value: expectedComposite,
        },
        completedAt: NOW,
      },
      tx,
    );
  });

  it('recovers idempotently when CompleteMultipartUpload returns NoSuchUpload because S3 already assembled the object', async () => {
    const intent = makePendingMultipartIntent();
    const expectedComposite = computeCompositeSha256([EXPECTED_SHA256, OTHER_SHA256]);
    const completedFile = makeCompletedFile({ sizeBytes: intent.expectedSizeBytes });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    storage.completeMultipartUpload.mockRejectedValue(
      new StorageObjectNotFoundError({
        operation: 'complete_multipart_upload',
        objectKey: intent.objectKey,
      }),
    );
    storage.headObject.mockResolvedValue({
      objectKey: intent.objectKey,
      sizeBytes: intent.expectedSizeBytes,
      contentType: intent.contentType,
      checksum: { type: 'composite_sha256', value: expectedComposite },
    });
    repo.completeCreateIntent.mockResolvedValue({ kind: 'completed', file: completedFile });

    await expect(
      service.completeUpload(USER, intent.uploadId, {
        parts: [
          { partNumber: 1, etag: '"etag-1"', sha256: EXPECTED_SHA256 },
          { partNumber: 2, etag: '"etag-2"', sha256: OTHER_SHA256 },
        ],
      }),
    ).resolves.toMatchObject({ kind: 'file', sizeBytes: intent.expectedSizeBytes });
  });

  it('maps StorageInvalidPartsError or incomplete part lists to upload_parts_invalid', async () => {
    const intent = makePendingMultipartIntent();
    repo.findByUserAndUploadId.mockResolvedValue(intent);

    await expect(
      service.completeUpload(USER, intent.uploadId, { parts: undefined }),
    ).rejects.toMatchObject({ code: 'upload_parts_invalid' });

    await expect(
      service.completeUpload(USER, intent.uploadId, {
        parts: [
          { partNumber: 1, etag: '"etag-1"', sha256: EXPECTED_SHA256 },
          { partNumber: 3, etag: '"etag-3"', sha256: OTHER_SHA256 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'upload_parts_invalid' });

    storage.completeMultipartUpload.mockRejectedValueOnce(
      new StorageInvalidPartsError({
        operation: 'complete_multipart_upload',
        objectKey: intent.objectKey,
      }),
    );
    await expect(
      service.completeUpload(USER, intent.uploadId, {
        parts: [
          { partNumber: 1, etag: '"bad"', sha256: EXPECTED_SHA256 },
          { partNumber: 2, etag: '"etag-2"', sha256: OTHER_SHA256 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'upload_parts_invalid' });
  });

  it('rejects completing an aborted upload without reading storage', async () => {
    const intent = makePendingMultipartIntent({ status: 'aborted' });
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_aborted',
    });
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it('aborts a pending multipart upload, queues deletion, and performs best-effort S3 abort', async () => {
    const intent = makePendingMultipartIntent();
    repo.findByUserAndUploadIdForUpdate.mockResolvedValue(intent);
    storage.abortMultipartUpload.mockRejectedValue(new Error('transient s3 error'));

    await expect(service.abortUpload(USER, intent.uploadId)).resolves.toBeUndefined();

    expect(repo.abortLockedIntent).toHaveBeenCalledExactlyOnceWith(intent.id, tx);
    expect(storage.abortMultipartUpload).toHaveBeenCalledExactlyOnceWith(
      intent.objectKey,
      intent.s3UploadId,
    );
  });

  it('treats aborting an already aborted intent as idempotent and rejects aborting a completed intent', async () => {
    repo.findByUserAndUploadIdForUpdate.mockResolvedValueOnce(
      makePendingMultipartIntent({ status: 'aborted' }),
    );
    await expect(service.abortUpload(USER, 'upload-1')).resolves.toBeUndefined();
    expect(repo.abortLockedIntent).not.toHaveBeenCalled();

    repo.findByUserAndUploadIdForUpdate.mockResolvedValueOnce(makeCompletedIntent());
    await expect(service.abortUpload(USER, 'upload-1')).rejects.toMatchObject({
      code: 'upload_already_completed',
    });
  });
});

function makePendingMultipartIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return makePendingIntent({
    expectedSizeBytes: SINGLE_PART_MAX_BYTES + 123,
    expectedSha256: null,
    uploadMode: 'multipart',
    s3UploadId: 's3-upload-id-1',
    partSizeBytes: MULTIPART_STANDARD_PART_SIZE_BYTES,
    partCount: 2,
    checksumType: 'composite_sha256',
    uploadUrlExpiresAt: null,
    finalizeDeadline: new Date(NOW.getTime() + 48 * 60 * 60_000),
    ...overrides,
  });
}

function makeAuthorizedFile(entryId: number, ownerId = USER.id): AuthorizedEntry {
  return {
    entry: {
      id: entryId,
      publicId: '20000000-0000-4000-8000-000000000001',
      ownerId,
      parentId: null,
      kind: 'file',
      name: 'document.txt',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    context: {
      scope: 'entry',
      actor: { userId: USER.id },
      resource: {
        id: entryId,
        ownerId,
        kind: 'file',
        deletedAt: null,
      },
      relationship: { grant: null },
      environment: { now: NOW },
    },
  };
}

function makePendingIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
    id: 1,
    uploadId: '00000000-0000-4000-8000-000000000001',
    createdByUserId: USER.id,
    targetParentId: null,
    fileId: null,
    fileName: 'document.txt',
    objectKey: `users/${USER.publicId}/objects/00000000-0000-4000-8000-000000000002`,
    contentType: 'text/plain',
    expectedSizeBytes: 12,
    expectedSha256: EXPECTED_SHA256,
    uploadMode: 'single',
    s3UploadId: null,
    partSizeBytes: null,
    partCount: null,
    checksumType: 'full_sha256',
    status: 'pending',
    createdAt: new Date(NOW.getTime() - 1_000),
    uploadUrlExpiresAt: new Date(NOW.getTime() + 60_000),
    finalizeDeadline: new Date(NOW.getTime() + 600_000),
    completedAt: null,
    operation: 'create',
    targetFileId: null,
    expectedContentVersion: null,
    ...overrides,
  };
}

function makeCompletedIntent(): UploadIntent {
  return {
    ...makePendingIntent(),
    fileId: 10,
    status: 'completed',
    completedAt: NOW,
  };
}

function makeObjectMetadata(
  intent: UploadIntent,
  overrides: Partial<ObjectMetadata> = {},
): ObjectMetadata {
  return {
    objectKey: intent.objectKey,
    sizeBytes: intent.expectedSizeBytes,
    contentType: intent.contentType,
    checksum: {
      type: 'full_sha256',
      value: EXPECTED_SHA256,
    },
    ...overrides,
  };
}

function makeCompletedFile(overrides: Partial<CompletedUploadFile> = {}): CompletedUploadFile {
  return {
    entryId: 10,
    publicId: '20000000-0000-4000-8000-000000000001',
    name: 'document.txt',
    contentType: 'text/plain',
    sizeBytes: 12,
    updatedAt: NOW,
    ...overrides,
  };
}
