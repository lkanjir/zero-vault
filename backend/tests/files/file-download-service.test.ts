import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type {
  AuthorizationResult,
  AuthorizationService,
} from '../../src/authorization/authorization-service.js';
import { FileDownloadService } from '../../src/files/file-download-service.js';
import type { DownloadableFile } from '../../src/files/file.js';
import type { FileRepository } from '../../src/files/file-repository.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import type { ObjectStorage } from '../../src/storage/object-storage.js';
import type { User } from '../../src/user/user.js';

const DOWNLOAD_URL = 'https://storage.example.test/download';
const FILE_PUBLIC_ID = '20000000-0000-4000-8000-000000000001';
const FILE_ENTRY_ID = 10;
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
  let authorizationService: MockProxy<AuthorizationService>;
  let repo: MockProxy<FileRepository>;
  let storage: MockProxy<ObjectStorage>;
  let service: FileDownloadService;

  beforeEach(() => {
    authorizationService = mock<AuthorizationService>();
    repo = mock<FileRepository>();
    storage = mock<ObjectStorage>();
    authorizationService.authorizeEntry.mockResolvedValue(makeAuthorizationResult());
    service = new FileDownloadService(authorizationService, repo, storage);
  });

  it('creates a short-lived download URL for an authorized available file', async () => {
    const file = makeDownloadableFile();

    repo.findAvailableFileByEntryId.mockResolvedValue(file);
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
    expect(authorizationService.authorizeEntry).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      entryPublicId: file.publicId,
      action: 'file:download',
    });
    expect(repo.findAvailableFileByEntryId).toHaveBeenCalledExactlyOnceWith(FILE_ENTRY_ID);
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledExactlyOnceWith({
      objectKey: file.objectKey,
      contentType: file.contentType,
      fileName: file.name,
      expiresInSeconds: 60,
    });
  });

  it('does not access file metadata or storage when authorization fails', async () => {
    const authorizationError = new AppError('entry_not_found');
    authorizationService.authorizeEntry.mockRejectedValue(authorizationError);

    await expect(service.createDownloadUrl(USER, FILE_PUBLIC_ID)).rejects.toBe(authorizationError);
    expect(repo.findAvailableFileByEntryId).not.toHaveBeenCalled();
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('does not create a signed URL when the authorized file is no longer available', async () => {
    repo.findAvailableFileByEntryId.mockResolvedValue(null);

    await expect(service.createDownloadUrl(USER, FILE_PUBLIC_ID)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('maps a download presign storage failure to storage_unavailable', async () => {
    const file = makeDownloadableFile();
    const storageError = new StorageUnavailableError(
      {
        operation: 'create_download_url',
        objectKey: file.objectKey,
      },
      { cause: new Error('S3 unavailable') },
    );

    repo.findAvailableFileByEntryId.mockResolvedValue(file);
    storage.createPresignedDownloadUrl.mockRejectedValue(storageError);

    await expect(service.createDownloadUrl(USER, file.publicId)).rejects.toMatchObject({
      code: 'storage_unavailable',
      options: {
        cause: storageError,
        context: {
          fileId: file.publicId,
          objectKey: file.objectKey,
          storageOperation: 'create_download_url',
        },
      },
    });
  });
});

function makeAuthorizationResult(): AuthorizationResult {
  return {
    context: {
      scope: 'entry',
      actor: {
        userId: USER.id,
      },
      resource: {
        id: FILE_ENTRY_ID,
        ownerId: USER.id,
        kind: 'file',
        deletedAt: null,
      },
      relationship: {
        grant: null,
      },
      environment: {
        now: new Date('2026-07-30T12:00:00Z'),
      },
    },
    accessLevel: 'owner',
  };
}

function makeDownloadableFile(overrides: Partial<DownloadableFile> = {}): DownloadableFile {
  return {
    entryId: FILE_ENTRY_ID,
    publicId: FILE_PUBLIC_ID,
    ownerId: USER.id,
    name: 'document.txt',
    objectKey: 'users/10000000-0000-4000-8000-000000000001/objects/object-id',
    contentType: 'text/plain',
    sizeBytes: 12,
    ...overrides,
  };
}
