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
import { ConflictError } from '../../src/shared/errors/conflict-error.js';
import { NotFoundError } from '../../src/shared/errors/not-found-error.js';
import type { User } from '../../src/user/user.js';

const EXPECTED_SHA256 = 'a'.repeat(64);
const EXPECTED_SHA256_BASE64 = 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=';
const OTHER_SHA256 = 'b'.repeat(64);
const SIGNED_URL = 'https://storage.example.test/upload';

const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  username: 'test',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
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
      contentType: ' text/plain ',
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
      uploadId: result.uploadId,
      createdByUserId: USER.id,
      fileName: 'document.txt',
      contentType: 'text/plain',
      expectedSizeBytes: 12,
      expectedSha256: EXPECTED_SHA256,
      status: 'pending',
      parentFolderId,
    });
  });

  it('given empty parentFolderId creates pending upload intent for root', async () => {
    storage.createPresignedUploadUrl.mockResolvedValue(SIGNED_URL);

    await service.createUpload(USER, {
      fileName: 'document.txt',
      contentType: ' text/plain ',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    expect(repo.save).toHaveBeenCalledOnce();
    expect(repo.save.mock.lastCall![0]).toMatchObject({
      parentFolderId: null,
    });
  });

  it('verifies the uploaded object and completes a pending upload', async () => {
    const intent = makePendingIntent();
    const completedFile = makeCompletedFile();

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeVerifiedUpload.mockResolvedValue(completed(completedFile));

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result).toStrictEqual({
      entryId: completedFile.entryId,
      uploadId: intent.uploadId,
      fileId: completedFile.publicId,
      fileName: completedFile.name,
      contentType: completedFile.contentType,
      sizeBytes: completedFile.sizeBytes,
      fileStatus: completedFile.status,
    });
    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith('quarantine', intent.objectKey);
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
    const completedFile = makeCompletedFile({ status: 'available' });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.completeVerifiedUpload.mockResolvedValue(completed(completedFile));

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result.fileStatus).toBe('available');
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
    ['missing provider checksum', { sha256Hex: null }, 'Uploaded object has no SHA-256 checksum'],
    [
      'checksum mismatch',
      { sha256Hex: OTHER_SHA256 },
      'Uploaded object checksum does not match intent',
    ],
    ['size mismatch', { sizeBytes: 99 }, 'Uploaded object size does not match intent'],
  ])('rejects an uploaded object with %s', async (_case, metadataOverrides, message) => {
    const intent = makePendingIntent();

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent, metadataOverrides));

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toThrow(
      new ConflictError(message),
    );
    expect(repo.completeVerifiedUpload).not.toHaveBeenCalled();
  });

  it('expires stale pending intents before reading object storage', async () => {
    const intent = makePendingIntent({
      finalizeDeadline: new Date(Date.now() - 1_000),
    });

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    repo.completeVerifiedUpload.mockResolvedValue({ kind: 'expired' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toThrow(
      new ConflictError('Upload intent expired'),
    );

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

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toThrow(
      new ConflictError('Upload intent expired'),
    );

    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith('quarantine', intent.objectKey);
    expect(repo.completeVerifiedUpload).toHaveBeenCalledOnce();
  });

  it('does not report success if completion loses a DB race', async () => {
    const intent = makePendingIntent();

    repo.findByUserAndUploadId.mockResolvedValue(intent);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));
    repo.completeVerifiedUpload.mockResolvedValue({ kind: 'not_pending', status: 'rejected' });

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toThrow(
      new ConflictError('Upload intent is not pending'),
    );
  });

  it('does not allow another user to complete the upload', async () => {
    repo.findByUserAndUploadId.mockResolvedValue(null);

    await expect(service.completeUpload({ ...USER, id: 2 }, 'upload-id')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(repo.completeVerifiedUpload).not.toHaveBeenCalled();
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
    status: 'quarantined',
    ...overrides,
  };
}

function completed(file: CompletedUploadFile): CompletedVerifiedUploadResult {
  return { kind: 'completed', file };
}
