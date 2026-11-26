import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthorizedEntry, EntryAuthorizer } from '../../src/authorization/entry-authorizer.js';
import type { AuditRepository } from '../../src/audit/audit-repository.js';
import type { TransactionContext, UnitOfWork } from '../../src/db/unit-of-work.js';
import { createFakeUnitOfWork } from '../helpers/fake-unit-of-work.js';
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
const NOW = new Date('2026-08-09T12:00:00.000Z');
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

describe('FileDownloadService', () => {
  let tx: TransactionContext;
  let unitOfWork: UnitOfWork;
  let runSpy: ReturnType<typeof createFakeUnitOfWork>['runSpy'];
  let entryAuthorizer: MockProxy<EntryAuthorizer>;
  let repo: MockProxy<FileRepository>;
  let auditRepository: MockProxy<AuditRepository>;
  let storage: MockProxy<ObjectStorage>;
  let service: FileDownloadService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ({ tx, unitOfWork, runSpy } = createFakeUnitOfWork());
    entryAuthorizer = mock<EntryAuthorizer>();
    repo = mock<FileRepository>();
    auditRepository = mock<AuditRepository>();
    storage = mock<ObjectStorage>();
    entryAuthorizer.authorizeForRead.mockResolvedValue(makeAuthorizedEntry());
    service = new FileDownloadService(unitOfWork, entryAuthorizer, repo, auditRepository, storage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('authorizes, loads file metadata, signs URL, and records audit inside one transaction', async () => {
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
    expect(runSpy).toHaveBeenCalledOnce();
    expect(entryAuthorizer.authorizeForRead).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        entryPublicId: file.publicId,
        actions: ['file:download'],
      },
      tx,
    );
    expect(repo.findAvailableFileByEntryId).toHaveBeenCalledExactlyOnceWith(FILE_ENTRY_ID, tx);
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledExactlyOnceWith({
      objectKey: file.objectKey,
      contentType: file.contentType,
      fileName: file.name,
      expiresInSeconds: 60,
    });
    expect(auditRepository.record).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: file.ownerId,
        actorUserId: USER.id,
        entryId: file.entryId,
        entryNameSnapshot: file.name,
        action: 'file.download_url_issued',
        details: {
          expiresInSeconds: 60,
        },
        occurredAt: NOW,
      },
      tx,
    );
  });

  it('does not access file metadata or storage when authorization fails', async () => {
    const authorizationError = new AppError('entry_not_found');
    entryAuthorizer.authorizeForRead.mockRejectedValue(authorizationError);

    await expect(service.createDownloadUrl(USER, FILE_PUBLIC_ID)).rejects.toBe(authorizationError);
    expect(repo.findAvailableFileByEntryId).not.toHaveBeenCalled();
    expect(auditRepository.record).not.toHaveBeenCalled();
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('does not create a signed URL when the authorized file is no longer available', async () => {
    repo.findAvailableFileByEntryId.mockResolvedValue(null);

    await expect(service.createDownloadUrl(USER, FILE_PUBLIC_ID)).rejects.toMatchObject({
      code: 'file_not_found',
    });
    expect(auditRepository.record).not.toHaveBeenCalled();
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('propagates a download presign storage failure without recording audit', async () => {
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

    await expect(service.createDownloadUrl(USER, file.publicId)).rejects.toBe(storageError);
    expect(auditRepository.record).not.toHaveBeenCalled();
  });

  it('does not return the signed URL when recording the audit event fails', async () => {
    const file = makeDownloadableFile();
    const auditError = new Error('audit unavailable');

    repo.findAvailableFileByEntryId.mockResolvedValue(file);
    storage.createPresignedDownloadUrl.mockResolvedValue(DOWNLOAD_URL);
    auditRepository.record.mockRejectedValue(auditError);

    await expect(service.createDownloadUrl(USER, file.publicId)).rejects.toBe(auditError);
  });
});

function makeAuthorizedEntry(): AuthorizedEntry {
  return {
    entry: {
      id: FILE_ENTRY_ID,
      publicId: FILE_PUBLIC_ID,
      ownerId: USER.id,
      parentId: null,
      kind: 'file',
      name: 'document.txt',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
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
