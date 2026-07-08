import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { FilePromotionService } from '../../src/files/file-promotion-service.js';
import type { FileRepository } from '../../src/files/file-repository.js';
import type { File } from '../../src/files/file.js';
import type { ObjectMetadata, ObjectStorage } from '../../src/storage/object-storage.js';
import { ConflictError } from '../../src/shared/errors/conflict-error.js';
import { NotFoundError } from '../../src/shared/errors/not-found-error.js';

const SHA256 = 'a'.repeat(64);

describe('FilePromotionService', () => {
  let repo: MockProxy<FileRepository>;
  let storage: MockProxy<ObjectStorage>;
  let service: FilePromotionService;

  beforeEach(() => {
    repo = mock<FileRepository>();
    storage = mock<ObjectStorage>();
    storage.deleteObject.mockResolvedValue(undefined);
    service = new FilePromotionService(repo, storage);
  });

  it('promotes a quarantined file to available and deletes the quarantine object', async () => {
    const file = makeFile();
    const availableFile = makeFile({ status: 'available', availableAt: new Date() });

    repo.findByEntryId.mockResolvedValue(file);
    storage.headObject.mockResolvedValue(makeObjectMetadata(file));
    repo.markAvailable.mockResolvedValue(availableFile);

    const result = await service.promoteFile(file.entryId);

    expect(result).toStrictEqual(availableFile);
    expect(storage.headObject).toHaveBeenCalledTimes(2);
    expect(storage.headObject).toHaveBeenNthCalledWith(1, 'quarantine', file.objectKey);
    expect(storage.headObject).toHaveBeenNthCalledWith(2, 'live', file.objectKey);
    expect(storage.copyObject).toHaveBeenCalledExactlyOnceWith(
      'quarantine',
      'live',
      file.objectKey,
    );
    expect(repo.markAvailable).toHaveBeenCalledExactlyOnceWith(file.entryId);
    expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith('quarantine', file.objectKey);
  });

  it('returns an already available file and retries quarantine cleanup', async () => {
    const file = makeFile({ status: 'available', availableAt: new Date() });

    repo.findByEntryId.mockResolvedValue(file);

    const result = await service.promoteFile(file.entryId);

    expect(result).toStrictEqual(file);
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(repo.markAvailable).not.toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith('quarantine', file.objectKey);
  });

  it('returns available if another request promoted the file first', async () => {
    const file = makeFile();
    const availableFile = makeFile({ status: 'available', availableAt: new Date() });

    repo.findByEntryId.mockResolvedValueOnce(file).mockResolvedValueOnce(availableFile);
    storage.headObject.mockResolvedValue(makeObjectMetadata(file));
    repo.markAvailable.mockResolvedValue(null);

    const result = await service.promoteFile(file.entryId);

    expect(result).toStrictEqual(availableFile);
    expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith('quarantine', file.objectKey);
  });

  it('rejects files whose storage metadata does not match the file record', async () => {
    const file = makeFile();

    repo.findByEntryId.mockResolvedValue(file);
    storage.headObject.mockResolvedValue(makeObjectMetadata(file, { sha256Hex: 'b'.repeat(64) }));

    await expect(service.promoteFile(file.entryId)).rejects.toThrow(
      new ConflictError('Object checksum does not match file record'),
    );
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(repo.markAvailable).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('does not promote missing or rejected files', async () => {
    await expect(service.promoteFile(1)).rejects.toBeInstanceOf(NotFoundError);

    repo.findByEntryId.mockResolvedValue(makeFile({ status: 'rejected' }));

    await expect(service.promoteFile(1)).rejects.toThrow(new ConflictError('File is rejected'));
    expect(storage.copyObject).not.toHaveBeenCalled();
  });
});

function makeFile(overrides: Partial<File> = {}): File {
  return {
    entryId: 10,
    objectKey: 'users/10000000-0000-4000-8000-000000000001/objects/object-id',
    contentType: 'text/plain',
    sizeBytes: 12,
    sha256: SHA256,
    status: 'quarantined',
    statusChangedAt: new Date('2026-01-01T00:00:00Z'),
    availableAt: null,
    ...overrides,
  };
}

function makeObjectMetadata(file: File, overrides: Partial<ObjectMetadata> = {}): ObjectMetadata {
  return {
    objectKey: file.objectKey,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    sha256Hex: file.sha256,
    ...overrides,
  };
}
