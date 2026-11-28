import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuditRepository } from '../../src/audit/audit-repository.js';
import type { AuthorizedEntry, EntryAuthorizer } from '../../src/authorization/entry-authorizer.js';
import type { TransactionContext, UnitOfWork } from '../../src/db/unit-of-work.js';
import { createFakeUnitOfWork } from '../helpers/fake-unit-of-work.js';
import type { FolderDownloadRepository } from '../../src/folder/download/folder-download-repository.js';
import { FolderDownloadService } from '../../src/folder/download/folder-download-service.js';
import type { FolderDownload } from '../../src/folder/download/folder-download.js';
import type { ObjectStorage } from '../../src/storage/object-storage.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import type { User } from '../../src/user/user.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';

const NOW = new Date('2026-07-28T10:00:00.000Z');
const DOWNLOAD_URL = 'https://storage.example.test/archive';
const FOLDER_PUBLIC_ID = '20000000-0000-4000-8000-000000000001';
const FOLDER_DB_ID = 20;
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
  let tx: TransactionContext;
  let unitOfWork: UnitOfWork;
  let runSpy: ReturnType<typeof createFakeUnitOfWork>['runSpy'];
  let entryAuthorizer: MockProxy<EntryAuthorizer>;
  let repository: MockProxy<FolderDownloadRepository>;
  let auditRepository: MockProxy<AuditRepository>;
  let storage: MockProxy<ObjectStorage>;
  let service: FolderDownloadService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ({ tx, unitOfWork, runSpy } = createFakeUnitOfWork());
    entryAuthorizer = mock<EntryAuthorizer>();
    repository = mock<FolderDownloadRepository>();
    auditRepository = mock<AuditRepository>();
    storage = mock<ObjectStorage>();
    entryAuthorizer.authorizeForRead.mockResolvedValue(makeAuthorizedFolder());
    repository.getArchiveSummary.mockResolvedValue({ fileCount: 1, totalSizeBytes: 12 });
    service = new FolderDownloadService(
      unitOfWork,
      entryAuthorizer,
      repository,
      auditRepository,
      storage,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('authorizes, creates an owner-scoped folder download, and records audit in one transaction', async () => {
    repository.create.mockImplementation((command) =>
      Promise.resolve(
        makeDownload({
          downloadId: command.downloadId,
          ownerId: command.ownerId,
          folderId: command.folderId,
          folderName: command.folderName,
          archiveObjectKey: command.archiveObjectKey,
          createdAt: command.createdAt,
        }),
      ),
    );

    const result = await service.createDownload(USER, FOLDER_PUBLIC_ID);

    expect(result).toStrictEqual({
      downloadId: result.downloadId,
      fileName: 'Documents.zip',
      status: 'queued',
    });
    expect(runSpy).toHaveBeenCalledOnce();
    expect(entryAuthorizer.authorizeForRead).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        entryPublicId: FOLDER_PUBLIC_ID,
        actions: ['folder:download'],
      },
      tx,
    );
    expect(repository.create).toHaveBeenCalledOnce();
    const [command, createTx] = repository.create.mock.lastCall!;
    expect(command).toStrictEqual({
      downloadId: result.downloadId,
      ownerId: USER.id,
      folderId: FOLDER_DB_ID,
      folderName: 'Documents',
      archiveObjectKey: `folder-downloads/${USER.publicId}/${result.downloadId}`,
      createdAt: NOW,
    });
    expect(createTx).toBe(tx);
    expect(command.archiveObjectKey).not.toContain(`/${USER.id}/`);
    expect(auditRepository.record).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: FOLDER_DB_ID,
        entryNameSnapshot: 'Documents',
        action: 'folder.archive_requested',
        details: {
          downloadId: result.downloadId,
        },
        occurredAt: NOW,
      },
      tx,
    );
  });

  it('does not create a download job or audit event when authorization is denied', async () => {
    const authorizationError = new AppError('entry_not_found');
    entryAuthorizer.authorizeForRead.mockRejectedValue(authorizationError);

    await expect(service.createDownload(USER, FOLDER_PUBLIC_ID)).rejects.toBe(authorizationError);

    expect(repository.create).not.toHaveBeenCalled();
    expect(auditRepository.record).not.toHaveBeenCalled();
  });

  it('rejects createDownload upfront when folder exceeds max file count or max total archive size', async () => {
    const limitedService = new FolderDownloadService(
      unitOfWork,
      entryAuthorizer,
      repository,
      auditRepository,
      storage,
      { maxFiles: 5, maxTotalBytes: 1_000 },
    );

    repository.getArchiveSummary.mockResolvedValueOnce({ fileCount: 6, totalSizeBytes: 500 });
    await expect(limitedService.createDownload(USER, FOLDER_PUBLIC_ID)).rejects.toMatchObject({
      code: 'folder_download_too_many_files',
    });

    repository.getArchiveSummary.mockResolvedValueOnce({ fileCount: 5, totalSizeBytes: 1_001 });
    await expect(limitedService.createDownload(USER, FOLDER_PUBLIC_ID)).rejects.toMatchObject({
      code: 'folder_download_too_large',
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(auditRepository.record).not.toHaveBeenCalled();
  });

  it('exposes Croatian failure details for user-facing archive limit failures and hides internal failure codes', async () => {
    const limitFailed = makeDownload({
      status: 'failed',
      failureCode: 'folder_download_too_large',
    });
    repository.findByOwnerAndDownloadId.mockResolvedValueOnce(limitFailed);

    await expect(service.getStatus(USER, limitFailed.downloadId)).resolves.toStrictEqual({
      downloadId: limitFailed.downloadId,
      fileName: 'Documents.zip',
      status: 'failed',
      failureCode: 'folder_download_too_large',
      message: 'Ukupna veličina datoteka u direktoriju prelazi dopuštenu veličinu ZIP arhive.',
    });

    const internalFailed = makeDownload({
      status: 'failed',
      failureCode: 'archive_creation_failed',
    });
    repository.findByOwnerAndDownloadId.mockResolvedValueOnce(internalFailed);

    await expect(service.getStatus(USER, internalFailed.downloadId)).resolves.toStrictEqual({
      downloadId: internalFailed.downloadId,
      fileName: 'Documents.zip',
      status: 'failed',
    });
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

  it('propagates archive presign failures to the HTTP error handler', async () => {
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

    await expect(service.getStatus(USER, download.downloadId)).rejects.toBe(storageError);
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

function makeAuthorizedFolder(): AuthorizedEntry {
  return {
    entry: {
      id: FOLDER_DB_ID,
      publicId: FOLDER_PUBLIC_ID,
      ownerId: USER.id,
      parentId: null,
      kind: 'folder',
      name: 'Documents',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    context: {
      scope: 'entry',
      actor: { userId: USER.id },
      resource: {
        id: FOLDER_DB_ID,
        ownerId: USER.id,
        kind: 'folder',
        deletedAt: null,
      },
      relationship: { grant: null },
      environment: { now: NOW },
    },
  };
}

function makeDownload(overrides: Partial<FolderDownload> = {}): FolderDownload {
  return {
    id: 10,
    downloadId: '30000000-0000-4000-8000-000000000001',
    ownerId: USER.id,
    folderId: FOLDER_DB_ID,
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
