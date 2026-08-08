import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { UploadService } from '../../src/upload/upload-service.js';
import type { UploadIntent } from '../../src/upload/upload-intent.js';
import type {
  CompletedUploadFile,
  CompletedVerifiedUploadResult,
  UploadIntentRepository,
} from '../../src/upload/upload-intent-repository.js';
import type { ObjectMetadata, ObjectStorage } from '../../src/storage/object-storage.js';
import type { User } from '../../src/user/user.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import { StorageObjectNotFoundError } from '../../src/shared/errors/storage/storage-object-not-found-error.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';

const EXPECTED_SHA256 = 'a'.repeat(64);
const EXPECTED_SHA256_BASE64 = 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=';
const OTHER_SHA256 = 'b'.repeat(64);
const SIGNED_URL = 'https://storage.example.test/upload';

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
  let storage: MockProxy<ObjectStorage>;
  let repo: MockProxy<UploadIntentRepository>;
  let service: UploadService;

  beforeEach(() => {
    storage = mock<ObjectStorage>();
    repo = mock<UploadIntentRepository>();
    service = new UploadService(storage, repo);
  });

  it('creates a pending upload intent and returns required upload headers', async () => {
    storage.createPresignedUploadUrl.mockResolvedValue(SIGNED_URL);

    const parentFolderId = '0e3a99c9-efc6-4302-8e50-02df497bab88';

    const result = await service.createUpload(USER, {
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
      parentFolderId: parentFolderId,
    });

    expect(result).toStrictEqual({
      uploadId: result.uploadId,
      uploadUrl: SIGNED_URL,
      expiresInSeconds: 60,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': EXPECTED_SHA256_BASE64,
      },
    });

    expect(storage.createPresignedUploadUrl).toHaveBeenCalledOnce();
    const [signedRequest] = storage.createPresignedUploadUrl.mock.lastCall!;
    expect(signedRequest.objectKey).toMatch(
      new RegExp(`^users/${USER.publicId}/objects/[0-9a-f-]{36}$`),
    );
    expect(signedRequest).toStrictEqual({
      objectKey: signedRequest.objectKey,
      contentType: 'text/plain',
      expiresInSeconds: 60,
      sha256Hex: EXPECTED_SHA256,
    });

    expect(repo.save).toHaveBeenCalledOnce();
    expect(repo.save.mock.lastCall![0]).toMatchObject({
      upload: {
        uploadId: result.uploadId,
        createdByUserId: USER.id,
        contentType: 'text/plain',
        expectedSizeBytes: 12,
        expectedSha256: EXPECTED_SHA256,
      },
      fileName: 'document.txt',
      parentFolderId,
    });
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
      parentFolderId: null,
    });
  });

  it('does not presign or save an upload when the target name already exists', async () => {
    const parentFolderId = '0e3a99c9-efc6-4302-8e50-02df497bab88';
    const duplicateError = new AppError('duplicate_entry_name');
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

    expect(repo.assertUploadTargetAvailable).toHaveBeenCalledExactlyOnceWith({
      userId: USER.id,
      parentFolderId,
      fileName: 'document.txt',
    });
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

    expect(repo.assertReplacementTargetAvailable).toHaveBeenCalledExactlyOnceWith({
      userId: USER.id,
      filePublicId,
    });
    expect(storage.createPresignedUploadUrl).toHaveBeenCalledOnce();
    expect(storage.createPresignedUploadUrl.mock.lastCall![0]).toMatchObject({
      contentType: 'application/pdf',
      expiresInSeconds: 60,
      sha256Hex: EXPECTED_SHA256,
    });
    expect(repo.saveReplacement).toHaveBeenCalledOnce();
    expect(repo.saveReplacement.mock.lastCall![0]).toMatchObject({
      filePublicId,
      upload: {
        uploadId: result.uploadId,
        createdByUserId: USER.id,
        contentType: 'application/pdf',
        expectedSizeBytes: 24,
        expectedSha256: EXPECTED_SHA256,
      },
    });
    expect(result).toStrictEqual({
      uploadId: result.uploadId,
      uploadUrl: SIGNED_URL,
      expiresInSeconds: 60,
      requiredHeaders: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-sha256': EXPECTED_SHA256_BASE64,
      },
    });
  });

  it('does not presign or save a replacement when fail-fast authorization rejects it', async () => {
    const filePublicId = '20000000-0000-4000-8000-000000000001';
    const authorizationError = new AppError('entry_not_found');
    repo.assertReplacementTargetAvailable.mockRejectedValue(authorizationError);

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

  it('verifies the uploaded object and completes a pending upload', async () => {
    const intent = makePendingIntent();
    const completedFile = makeCompletedFile();

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeVerifiedUpload.mockResolvedValue(completed(completedFile));

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result).toStrictEqual(completedFile);
    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(intent.objectKey);
    expect(repo.completeVerifiedUpload).toHaveBeenCalledOnce();
    const [completeCommand] = repo.completeVerifiedUpload.mock.lastCall!;
    expect(completeCommand).toMatchObject({
      userId: USER.id,
      uploadId: intent.uploadId,
    });
    expect(completeCommand.completedAt).toBeInstanceOf(Date);
  });

  it('returns an already completed upload without reading object storage', async () => {
    const intent = makeCompletedIntent();
    const completedFile = makeCompletedFile();

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.completeVerifiedUpload.mockResolvedValue(completed(completedFile));

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result).toStrictEqual(completedFile);
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(repo.completeVerifiedUpload).toHaveBeenCalledOnce();
    const [completeCommand] = repo.completeVerifiedUpload.mock.lastCall!;
    expect(completeCommand).toMatchObject({
      userId: USER.id,
      uploadId: intent.uploadId,
    });
    expect(completeCommand.completedAt).toBeInstanceOf(Date);
  });

  it.each([
    ['missing provider checksum', { sha256Hex: null }, 'upload_checksum_missing', {}],
    [
      'checksum mismatch',
      { sha256Hex: OTHER_SHA256 },
      'upload_checksum_mismatch',
      { objectHash: OTHER_SHA256, intentHash: EXPECTED_SHA256 },
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
      expect(repo.completeVerifiedUpload).not.toHaveBeenCalled();
    },
  );

  it('expires stale pending intents before reading object storage', async () => {
    const intent = makePendingIntent({
      finalizeDeadline: new Date(Date.now() - 1_000),
    });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.completeVerifiedUpload.mockResolvedValue({ kind: 'expired' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_expired',
    });

    expect(storage.headObject).not.toHaveBeenCalled();
    expect(repo.completeVerifiedUpload).toHaveBeenCalledOnce();
  });

  it('reports expired if finalize deadline passes during repository completion', async () => {
    const intent = makePendingIntent({
      finalizeDeadline: new Date(Date.now() + 60_000),
    });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeVerifiedUpload.mockResolvedValue({ kind: 'expired' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_expired',
    });

    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(intent.objectKey);
    expect(repo.completeVerifiedUpload).toHaveBeenCalledOnce();
  });

  it('does not allow another user to complete the upload', async () => {
    repo.findByUserAndUploadId.mockResolvedValue(null);

    await expect(service.completeUpload({ ...USER, id: 2 }, 'upload-id')).rejects.toMatchObject({
      code: 'upload_not_found',
    });
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(repo.completeVerifiedUpload).not.toHaveBeenCalled();
  });

  it('maps upload presign storage failure to storage_unavailable and does not save intent', async () => {
    const storageError = new StorageUnavailableError(
      { operation: 'create_upload_url', objectKey: 'object-key' },
      { cause: new Error('S3 unavailable') },
    );
    storage.createPresignedUploadUrl.mockRejectedValue(storageError);

    const promise = service.createUpload(USER, {
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });
    const error: unknown = await promise.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    if (!(error instanceof AppError)) return;

    expect(error).toMatchObject({
      code: 'storage_unavailable',
      options: {
        cause: storageError,
        context: {
          storageOperation: 'create_upload_url',
        },
      },
    });
    expect(typeof error.options.context?.['uploadId']).toBe('string');
    expect(typeof error.options.context?.['objectKey']).toBe('string');
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
    expect(repo.completeVerifiedUpload).not.toHaveBeenCalled();
  });

  it('maps a head request storage failure to storage_unavailable', async () => {
    const intent = makePendingIntent();
    const storageError = new StorageUnavailableError(
      { operation: 'head_object', objectKey: intent.objectKey },
      { cause: new Error('S3 unavailable') },
    );
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockRejectedValue(storageError);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'storage_unavailable',
      options: {
        cause: storageError,
        context: {
          uploadId: intent.uploadId,
          objectKey: intent.objectKey,
          storageOperation: 'head_object',
        },
      },
    });
    expect(repo.completeVerifiedUpload).not.toHaveBeenCalled();
  });

  it('maps a repository completion race to upload_not_found', async () => {
    const intent = makePendingIntent();
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeVerifiedUpload.mockResolvedValue({ kind: 'not_found' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'upload_not_found',
    });
  });

  it('maps a superseded replacement completion to replacement_conflict', async () => {
    const intent = makePendingIntent({
      operation: 'replace',
      fileName: null,
      targetFileId: 10,
      expectedContentVersion: 1,
    });
    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeVerifiedUpload.mockResolvedValue({ kind: 'superseded' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'replacement_conflict',
    });

    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(intent.objectKey);
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
    repo.completeVerifiedUpload.mockResolvedValue({ kind: 'superseded' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toMatchObject({
      code: 'replacement_conflict',
    });

    expect(storage.headObject).not.toHaveBeenCalled();
  });
});

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
    status: 'pending',
    createdAt: new Date(Date.now() - 1_000),
    uploadUrlExpiresAt: new Date(Date.now() + 60_000),
    finalizeDeadline: new Date(Date.now() + 600_000),
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
    completedAt: new Date(),
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
    sha256Hex: EXPECTED_SHA256,
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
    updatedAt: new Date(),
    ...overrides,
  };
}

function completed(file: CompletedUploadFile): CompletedVerifiedUploadResult {
  return { kind: 'completed', file };
}
