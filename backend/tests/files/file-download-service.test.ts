import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { FileDownloadService } from '../../src/files/file-download-service.js';
import type { DownloadableFile } from '../../src/files/file.js';
import type { FileRepository } from '../../src/files/file-repository.js';
import { NotFoundError } from '../../src/shared/errors/not-found-error.js';
import type { ObjectStorage } from '../../src/storage/object-storage.js';
import type { User } from '../../src/user/user.js';

const DOWNLOAD_URL = 'https://storage.example.test/download';
const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  username: 'test',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('FileDownloadService', () => {
  let repo: MockProxy<FileRepository>;
  let storage: MockProxy<ObjectStorage>;
  let service: FileDownloadService;

  beforeEach(() => {
    repo = mock<FileRepository>();
    storage = mock<ObjectStorage>();
    service = new FileDownloadService(repo, storage);
  });

  it('creates a short-lived download URL for an available owned file', async () => {
    const file = makeDownloadableFile();

    repo.findAvailableFileByPublicIdForOwner.mockResolvedValue(file);
    storage.createPresignedDownloadUrl.mockResolvedValue(DOWNLOAD_URL);

    const result = await service.createDownloadUrl(USER, file.publicId);

    expect(result).toStrictEqual({
      fileId: file.publicId,
      fileName: file.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      downloadUrl: DOWNLOAD_URL,
      expiresInSeconds: 60,
    });
    expect(repo.findAvailableFileByPublicIdForOwner).toHaveBeenCalledExactlyOnceWith(
      file.publicId,
      USER.id,
    );
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledExactlyOnceWith({
      objectKey: file.objectKey,
      contentType: file.contentType,
      fileName: file.name,
      expiresInSeconds: 60,
    });
  });

  it('does not create a signed URL when the owner-scoped lookup fails', async () => {
    repo.findAvailableFileByPublicIdForOwner.mockResolvedValue(null);

    await expect(
      service.createDownloadUrl(USER, '20000000-0000-4000-8000-000000000001'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });
});

function makeDownloadableFile(overrides: Partial<DownloadableFile> = {}): DownloadableFile {
  return {
    entryId: 10,
    publicId: '20000000-0000-4000-8000-000000000001',
    ownerId: USER.id,
    name: 'document.txt',
    objectKey: 'users/10000000-0000-4000-8000-000000000001/objects/object-id',
    contentType: 'text/plain',
    sizeBytes: 12,
    ...overrides,
  };
}
