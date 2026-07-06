import { beforeEach, describe, expect, it } from 'vitest';
import { UploadService } from '../src/upload/upload-service.js';
import type { UploadIntent } from '../src/upload/upload-intent.js';
import type { UploadIntentRepository } from '../src/upload/upload-intent-repository.js';
import type { ObjectMetadata, ObjectStorage } from '../src/storage/object-storage.js';
import { ConflictError } from '../src/shared/errors/conflict-error.js';
import type { User } from '../src/user/user.js';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { NotFoundError } from '../src/shared/errors/not-found-error.js';

const EXPECTED_SHA256 = 'a'.repeat(64);
const EXPECTED_SHA256_BASE64 = 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=';
const OTHER_SHA256 = 'b'.repeat(64);
const SIGNED_URL = 'https://storage.example.test/upload';
const USER: User = {
  id: 1,
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  username: 'test',
  createdAt: new Date(),
  updatedAt: new Date(),
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

  it('stores the expected checksum and signs the upload with it', async () => {
    storage.createPresignedUrl.mockResolvedValue(SIGNED_URL);
    repo.save.mockResolvedValue(undefined);

    const result = await service.createUpload(USER, {
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    expect(result).toStrictEqual({
      uploadId: result.uploadId,
      uploadUrl: SIGNED_URL,
      sha256Base64: EXPECTED_SHA256_BASE64,
      expiresInSeconds: 60,
    });
    expect(result.uploadId).toMatch(/^[0-9a-f-]{36}$/);

    expect(storage.createPresignedUrl).toHaveBeenCalledOnce();
    const [signedRequest] = storage.createPresignedUrl.mock.lastCall!;
    expect(signedRequest).toStrictEqual({
      objectKey: signedRequest.objectKey,
      contentType: 'text/plain',
      expiresInSeconds: 60,
      sha256Hex: EXPECTED_SHA256,
    });
    expect(signedRequest.objectKey).toMatch(
      new RegExp(`^quarantine/${result.uploadId}/[0-9a-f-]{36}$`),
    );

    expect(repo.save).toHaveBeenCalledOnce();
    const [savedIntent] = repo.save.mock.lastCall!;
    expect(savedIntent).toMatchObject({
      createdByUserId: USER.id,
      uploadId: result.uploadId,
      objectKey: signedRequest.objectKey,
      expectedSha256: EXPECTED_SHA256,
      actualSha256: null,
      checksumVerifiedAt: null,
      status: 'pending',
    });
  });

  it('verifies checksum metadata and persists the actual checksum on completion', async () => {
    const intent = makePendingIntent();

    repo.findByUserAndUploadId.mockResolvedValue(structuredClone(intent));
    repo.update.mockResolvedValue(true);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));

    const result = await service.completeUpload(USER, intent.uploadId);

    expect(result.status).toBe('completed');
    expect(result.objectKey).toBe(intent.objectKey);
    expect(repo.findByUserAndUploadId).toHaveBeenCalledExactlyOnceWith(USER.id, intent.uploadId);
    expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(intent.objectKey);

    expect(repo.update).toHaveBeenCalledOnce();
    const [updatedIntent] = repo.update.mock.lastCall!;
    expect(updatedIntent).toMatchObject({
      status: 'completed',
      actualSha256: EXPECTED_SHA256,
    });
    expect(updatedIntent.completedAt).toBeInstanceOf(Date);
    expect(updatedIntent.checksumVerifiedAt).toBeInstanceOf(Date);
  });

  it.each([
    [
      'whose checksum does not match',
      { sha256Hex: OTHER_SHA256 },
      'Uploaded object checksum does not match intent',
    ],
    [
      'without provider checksum metadata',
      { sha256Hex: null },
      'Uploaded object has no SHA-256 checksum',
    ],
  ])('rejects an object %s', async (_case, metadataOverrides, errorMessage) => {
    const intent = makePendingIntent();

    repo.findByUserAndUploadId.mockResolvedValue(structuredClone(intent));
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent, metadataOverrides));

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toThrow(
      new ConflictError(errorMessage),
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('expires old intents before reading object storage', async () => {
    const intent = makePendingIntent({
      expiredAt: new Date(Date.now() - 1_000),
    });

    repo.findByUserAndUploadId.mockResolvedValue(structuredClone(intent));
    repo.update.mockResolvedValue(true);

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toThrow(
      new ConflictError('Upload intent expired'),
    );

    expect(storage.headObject).not.toHaveBeenCalled();

    expect(repo.update).toHaveBeenCalledOnce();
    const [updatedIntent] = repo.update.mock.lastCall!;
    expect(updatedIntent.status).toBe('expired');
  });

  it('does not report success if the pending DB update loses a race', async () => {
    const intent = makePendingIntent();

    repo.findByUserAndUploadId.mockResolvedValue(structuredClone(intent));
    repo.update.mockResolvedValue(false);
    storage.headObject.mockResolvedValue(makeObjectMetadata(intent));

    await expect(service.completeUpload(USER, intent.uploadId)).rejects.toThrow(
      new ConflictError('Upload intent is not pending'),
    );

    expect(repo.update).toHaveBeenCalledOnce();
    const [attemptedUpdate] = repo.update.mock.lastCall!;
    expect(attemptedUpdate).toMatchObject({
      status: 'completed',
      actualSha256: EXPECTED_SHA256,
    });
  });

  it('other user is not allowed to complete the intent', async () => {
    const intent = makePendingIntent();
    const otherUser = {
      ...USER,
      id: 2,
      subject: 'other-user',
    };

    repo.findByUserAndUploadId.calledWith(otherUser.id, intent.uploadId).mockResolvedValue(null);

    await expect(service.completeUpload(otherUser, intent.uploadId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});

function makePendingIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
    createdByUserId: USER.id,
    uploadId: '00000000-0000-4000-8000-000000000001',
    objectKey: 'quarantine/00000000-0000-4000-8000-000000000001/object',
    fileName: 'document.txt',
    contentType: 'text/plain',
    size: 12,
    status: 'pending',
    expectedSha256: EXPECTED_SHA256,
    actualSha256: null,
    checksumVerifiedAt: null,
    createdAt: new Date(Date.now() - 1_000),
    expiredAt: new Date(Date.now() + 60_000),
    completedAt: null,
    ...overrides,
  };
}

function makeObjectMetadata(
  intent: UploadIntent,
  overrides: Partial<ObjectMetadata> = {},
): ObjectMetadata {
  return {
    objectKey: intent.objectKey,
    size: intent.size,
    contentType: intent.contentType,
    sha256Hex: EXPECTED_SHA256,
    ...overrides,
  };
}
