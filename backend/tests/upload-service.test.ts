import { describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { UploadService } from '../src/upload/upload-service.js';
import type { UploadIntent } from '../src/upload/upload-intent.js';
import type { UploadIntentRepository } from '../src/upload/upload-intent-repository.js';
import type { ObjectMetadata, ObjectStorage } from '../src/storage/object-storage.js';
import { ConflictError } from '../src/shared/errors/conflict-error.js';
import { sha256HexToBase64 } from '../src/shared/utils/sha256-convert.js';

const EXPECTED_SHA256 = 'a'.repeat(64);
const OTHER_SHA256 = 'b'.repeat(64);
const SIGNED_URL = 'https://storage.example.test/upload';

describe('UploadService', () => {
  it('stores the expected checksum and signs the upload with it', async () => {
    const { storage, repo, service } = setup();

    storage.createPresignedUrl.mockResolvedValue(SIGNED_URL);
    repo.save.mockResolvedValue(undefined);
    
    const result = await service.createUpload({
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    expect(result.uploadUrl).toBe(SIGNED_URL);
    expect(result.sha256Base64).toBe(sha256HexToBase64(EXPECTED_SHA256));
    expect(result.expiresInSeconds).toBe(60);

    expect(storage.createPresignedUrl.mock.calls).toHaveLength(1);
    const signedRequest = requireSingle(storage.createPresignedUrl.mock.calls)[0];
    expect(signedRequest.objectKey).toMatch(/^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect(signedRequest.contentType).toBe('text/plain');
    expect(signedRequest.expiresInSeconds).toBe(60);
    expect(signedRequest.sha256Hex).toBe(EXPECTED_SHA256);

    const savedIntent = requireSingle(repo.save.mock.calls)[0];
    expect(savedIntent.expectedSha256).toBe(EXPECTED_SHA256);
    expect(savedIntent.actualSha256).toBeNull();
    expect(savedIntent.checksumVerifiedAt).toBeNull();
    expect(savedIntent.status).toBe('pending');
  });

  it('verifies checksum metadata and persists the actual checksum on completion', async () => {
    const { storage, repo, service } = setup();
    const intent = makePendingIntent();

    repo.findByUploadId.calledWith(intent.uploadId).mockResolvedValue(cloneIntent(intent));
    repo.update.mockResolvedValue(true);
    storage.headObject.calledWith(intent.objectKey).mockResolvedValue(makeObjectMetadata(intent));

    const result = await service.completeUpload(intent.uploadId);

    expect(result.status).toBe('completed');
    expect(result.objectKey).toBe(intent.objectKey);
    expect(storage.headObject.mock.calls).toEqual([[intent.objectKey]]);

    const updatedIntent = requireSingle(repo.update.mock.calls)[0];
    expect(updatedIntent.status).toBe('completed');
    expect(updatedIntent.actualSha256).toBe(EXPECTED_SHA256);
    expect(updatedIntent.completedAt).toBeInstanceOf(Date);
    expect(updatedIntent.checksumVerifiedAt).toBeInstanceOf(Date);
    expect(updatedIntent.completedAt?.getTime()).toBe(updatedIntent.checksumVerifiedAt?.getTime());
  });

  it('rejects an object whose checksum does not match the intent', async () => {
    const { storage, repo, service } = setup();
    const intent = makePendingIntent();

    repo.findByUploadId.calledWith(intent.uploadId).mockResolvedValue(cloneIntent(intent));
    storage.headObject
      .calledWith(intent.objectKey)
      .mockResolvedValue(makeObjectMetadata(intent, { sha256Hex: OTHER_SHA256 }));

    await expect(service.completeUpload(intent.uploadId)).rejects.toThrow(
      new ConflictError('Uploaded object checksum does not match intent'),
    );
    expect(repo.update.mock.calls).toHaveLength(0);
  });

  it('rejects an object without provider checksum metadata', async () => {
    const { storage, repo, service } = setup();
    const intent = makePendingIntent();

    repo.findByUploadId.calledWith(intent.uploadId).mockResolvedValue(cloneIntent(intent));
    storage.headObject
      .calledWith(intent.objectKey)
      .mockResolvedValue(makeObjectMetadata(intent, { sha256Hex: null }));

    await expect(service.completeUpload(intent.uploadId)).rejects.toThrow(
      new ConflictError('Uploaded object has no SHA-256 checksum'),
    );
    expect(repo.update.mock.calls).toHaveLength(0);
  });

  it('expires old intents before reading object storage', async () => {
    const { storage, repo, service } = setup();
    const intent = makePendingIntent({
      expiredAt: new Date(Date.now() - 1_000),
    });

    repo.findByUploadId.calledWith(intent.uploadId).mockResolvedValue(cloneIntent(intent));
    repo.update.mockResolvedValue(true);

    await expect(service.completeUpload(intent.uploadId)).rejects.toThrow(
      new ConflictError('Upload intent expired'),
    );

    expect(storage.headObject.mock.calls).toHaveLength(0);
    const updatedIntent = requireSingle(repo.update.mock.calls)[0];
    expect(updatedIntent.status).toBe('expired');
  });

  it('does not report success if the pending DB update loses a race', async () => {
    const { storage, repo, service } = setup();
    const intent = makePendingIntent();

    repo.findByUploadId.calledWith(intent.uploadId).mockResolvedValue(cloneIntent(intent));
    repo.update.mockResolvedValue(false);
    storage.headObject.calledWith(intent.objectKey).mockResolvedValue(makeObjectMetadata(intent));

    await expect(service.completeUpload(intent.uploadId)).rejects.toThrow(
      new ConflictError('Upload intent is not pending'),
    );

    const attemptedUpdate = requireSingle(repo.update.mock.calls)[0];
    expect(attemptedUpdate.status).toBe('completed');
    expect(attemptedUpdate.actualSha256).toBe(EXPECTED_SHA256);
  });
});

function setup(): {
  storage: MockProxy<ObjectStorage>;
  repo: MockProxy<UploadIntentRepository>;
  service: UploadService;
} {
  const storage = mock<ObjectStorage>();
  const repo = mock<UploadIntentRepository>();
  const service = new UploadService(storage, repo);

  return { storage, repo, service };
}

function makePendingIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
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

function cloneIntent(intent: UploadIntent): UploadIntent {
  return {
    uploadId: intent.uploadId,
    objectKey: intent.objectKey,
    fileName: intent.fileName,
    contentType: intent.contentType,
    size: intent.size,
    status: intent.status,
    expectedSha256: intent.expectedSha256,
    actualSha256: intent.actualSha256 ?? null,
    checksumVerifiedAt: cloneDate(intent.checksumVerifiedAt ?? null),
    createdAt: new Date(intent.createdAt),
    expiredAt: new Date(intent.expiredAt),
    completedAt: cloneDate(intent.completedAt ?? null),
  };
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function requireSingle<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  const item = items[0];

  if (item === undefined) {
    throw new Error('Expected exactly one item');
  }

  return item;
}
