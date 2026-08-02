import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { FolderDownloadRepository } from '../../src/folder/download/folder-download-repository.js';
import { FolderDownloadService } from '../../src/folder/download/folder-download-service.js';
import type { FolderDownload } from '../../src/folder/download/folder-download.js';
import type { ObjectStorage } from '../../src/storage/object-storage.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import type { User } from '../../src/user/user.js';
import type { AuthorizationService } from '../../src/authorization/authorization-service.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';

const NOW = new Date('2026-07-28T10:00:00.000Z');
const DOWNLOAD_URL = 'https://storage.example.test/archive';
const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

describe('FolderDownloadService', () => {
  let authz: MockProxy<AuthorizationService>;
  let repository: MockProxy<FolderDownloadRepository>;
  let storage: MockProxy<ObjectStorage>;
  let service: FolderDownloadService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    authz = mock<AuthorizationService>();
    repository = mock<FolderDownloadRepository>();
    storage = mock<ObjectStorage>();
    service = new FolderDownloadService(authz, repository, storage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an owner-scoped folder download with a non-internal object prefix', async () => {
    repository.create.mockImplementation((command) =>
      Promise.resolve(
        makeDownload({
          downloadId: command.downloadId,
          ownerId: command.ownerId,
          archiveObjectKey: command.archiveObjectKey,
          createdAt: command.createdAt,
        }),
      ),
    );

    const result = await service.createDownload(USER, '20000000-0000-4000-8000-000000000001');

    expect(result).toStrictEqual({
      downloadId: result.downloadId,
      fileName: 'Documents.zip',
      status: 'queued',
    });
    expect(authz.authorizeEntryByPublicId).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      entryPublicId: '20000000-0000-4000-8000-000000000001',
      action: 'folder:download',
    });
    expect(repository.create).toHaveBeenCalledOnce();
    const [command] = repository.create.mock.lastCall!;
    expect(command).toStrictEqual({
      downloadId: result.downloadId,
      ownerId: USER.id,
      folderPublicId: '20000000-0000-4000-8000-000000000001',
      archiveObjectKey: `folder-downloads/${USER.publicId}/${result.downloadId}`,
      createdAt: NOW,
    });
    expect(command.archiveObjectKey).not.toContain(`/${USER.id}/`);
  });

  it('does not create a download job when authorization is denied', async () => {
    const authorizationError = new AppError('entry_not_found');
    authz.authorizeEntryByPublicId.mockRejectedValue(authorizationError);

    await expect(service.createDownload(USER, '20000000-0000-4000-8000-000000000001')).rejects.toBe(
      authorizationError,
    );

    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each(['queued', 'processing'] as const)(
    'returns the %s status without storage access',
    async (status) => {
      repository.findByOwnerAndDownloadId.mockResolvedValue(makeDownload({ status }));

      await expect(service.getStatus(USER, makeDownload().downloadId)).resolves.toStrictEqual({
        downloadId: makeDownload().downloadId,
        fileName: 'Documents.zip',
        status,
      });
      expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
    },
  );

  it('returns a short-lived URL for a ready archive', async () => {
    const download = makeDownload({
      status: 'ready',
      archiveObjectKey: 'folder-downloads/user/download/1.zip',
      archiveSizeBytes: 321,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    repository.findByOwnerAndDownloadId.mockResolvedValue(download);
    storage.createPresignedDownloadUrl.mockResolvedValue(DOWNLOAD_URL);

    await expect(service.getStatus(USER, download.downloadId)).resolves.toStrictEqual({
      downloadId: download.downloadId,
      fileName: 'Documents.zip',
      status: 'ready',
      sizeBytes: 321,
      expiresAt: download.expiresAt!.toISOString(),
      downloadUrl: DOWNLOAD_URL,
      expiresInSeconds: 60,
    });
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledExactlyOnceWith({
      objectKey: download.archiveObjectKey,
      fileName: 'Documents.zip',
      contentType: 'application/zip',
      expiresInSeconds: 60,
    });
  });

  it('reports a time-expired ready archive without creating a URL', async () => {
    const download = makeDownload({
      status: 'ready',
      archiveSizeBytes: 321,
      expiresAt: NOW,
    });
    repository.findByOwnerAndDownloadId.mockResolvedValue(download);

    await expect(service.getStatus(USER, download.downloadId)).resolves.toStrictEqual({
      downloadId: download.downloadId,
      fileName: 'Documents.zip',
      status: 'expired',
    });
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('rejects a ready archive with incomplete metadata', async () => {
    const download = makeDownload({
      status: 'ready',
      archiveSizeBytes: null,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    repository.findByOwnerAndDownloadId.mockResolvedValue(download);

    await expect(service.getStatus(USER, download.downloadId)).rejects.toMatchObject({
      code: 'internal_server_error',
    });
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('maps archive presign failures to storage_unavailable', async () => {
    const download = makeDownload({
      status: 'ready',
      archiveSizeBytes: 321,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const storageError = new StorageUnavailableError(
      { operation: 'create_download_url', objectKey: download.archiveObjectKey },
      { cause: new Error('storage down') },
    );
    repository.findByOwnerAndDownloadId.mockResolvedValue(download);
    storage.createPresignedDownloadUrl.mockRejectedValue(storageError);

    await expect(service.getStatus(USER, download.downloadId)).rejects.toMatchObject({
      code: 'storage_unavailable',
      options: {
        cause: storageError,
        context: {
          downloadId: download.downloadId,
          objectKey: download.archiveObjectKey,
          storageOperation: 'create_download_url',
        },
      },
    });
  });

  it('does not disclose a download that is not owned by the user', async () => {
    repository.findByOwnerAndDownloadId.mockResolvedValue(null);

    await expect(service.getStatus(USER, makeDownload().downloadId)).rejects.toMatchObject({
      code: 'folder_download_not_found',
    });
    expect(repository.findByOwnerAndDownloadId).toHaveBeenCalledExactlyOnceWith(
      USER.id,
      makeDownload().downloadId,
    );
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });
});

function makeDownload(overrides: Partial<FolderDownload> = {}): FolderDownload {
  return {
    id: 10,
    downloadId: '30000000-0000-4000-8000-000000000001',
    ownerId: USER.id,
    folderId: 20,
    folderName: 'Documents',
    archiveObjectKey:
      'folder-downloads/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001',
    status: 'queued',
    attemptCount: 0,
    archiveSizeBytes: null,
    failureCode: null,
    createdAt: NOW,
    startedAt: null,
    finishedAt: null,
    leaseExpiresAt: null,
    expiresAt: null,
    ...overrides,
  };
}
