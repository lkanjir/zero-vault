import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { EntryAccessMapper } from '../../src/authorization/entry-access-mapper.js';
import { AuthorizationPolicy } from '../../src/authorization/authorization-policy.js';
import type { AuthorizationService } from '../../src/authorization/authorization-service.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type {
  FileGrantRepository,
  SharedFileRecord,
} from '../../src/sharing/file-grant-repository.js';
import {
  decodeFileGrantListCursor,
  encodeFileGrantListCursor,
} from '../../src/sharing/file-grant-list-cursor.js';
import type { FileGrant } from '../../src/sharing/file-grant.js';
import { FileSharingService } from '../../src/sharing/file-sharing-service.js';
import {
  decodeSharedFileListCursor,
  encodeSharedFileListCursor,
} from '../../src/sharing/shared-file-list-cursor.js';
import type { User } from '../../src/user/user.js';

const NOW = new Date('2026-08-01T10:00:00.000Z');
const FILE_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_FILE_ID = '20000000-0000-4000-8000-000000000002';
const FILE_DB_ID = 42;
const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'owner-subject',
  email: 'owner@example.com',
  firstName: 'Test',
  lastName: 'Owner',
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

describe('FileSharingService', () => {
  let authorizationService: MockProxy<AuthorizationService>;
  let repository: MockProxy<FileGrantRepository>;
  let service: FileSharingService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    authorizationService = mock<AuthorizationService>();
    repository = mock<FileGrantRepository>();
    service = new FileSharingService(
      authorizationService,
      repository,
      new EntryAccessMapper(new AuthorizationPolicy()),
    );

    authorizationService.authorizeEntryByPublicId.mockResolvedValue({
      accessLevel: 'owner',
      context: {
        scope: 'entry',
        actor: { userId: USER.id },
        resource: {
          id: FILE_DB_ID,
          ownerId: USER.id,
          kind: 'file',
          deletedAt: null,
        },
        relationship: { grant: null },
        environment: { now: NOW },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the current 48-hour pending activation window', async () => {
    await service.shareFile(USER, FILE_ID, {
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
    });

    expect(authorizationService.authorizeEntryByPublicId).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      entryPublicId: FILE_ID,
      action: 'share:manage',
    });
    expect(repository.save).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      filePublicId: FILE_ID,
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: NOW,
      pendingActivationDeadline: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
    });
  });

  it('uses an earlier access expiry as the pending activation deadline', async () => {
    const expiresAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);

    await service.shareFile(USER, FILE_ID, {
      recipientEmail: 'recipient@example.com',
      permission: 'editor',
      expiresAt,
    });

    expect(repository.save).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      filePublicId: FILE_ID,
      recipientEmail: 'recipient@example.com',
      permission: 'editor',
      expiresAt,
      submittedAt: NOW,
      pendingActivationDeadline: expiresAt,
    });
  });

  it.each([
    ['equal to the current time', NOW],
    ['before the current time', new Date(NOW.getTime() - 1)],
  ])('rejects an expiry %s', async (_case, expiresAt) => {
    await expect(
      service.shareFile(USER, FILE_ID, {
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
        expiresAt,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_grant_expiry',
    });

    expect(authorizationService.authorizeEntryByPublicId).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('authorizes but does not persist a self-share', async () => {
    await service.shareFile(USER, FILE_ID, {
      recipientEmail: USER.email,
      permission: 'editor',
      expiresAt: null,
    });

    expect(authorizationService.authorizeEntryByPublicId).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      entryPublicId: FILE_ID,
      action: 'share:manage',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('does not persist when early authorization is denied', async () => {
    const error = new AppError('entry_not_found');
    authorizationService.authorizeEntryByPublicId.mockRejectedValue(error);

    await expect(
      service.shareFile(USER, FILE_ID, {
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
        expiresAt: null,
      }),
    ).rejects.toBe(error);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('propagates a repository failure after successful early authorization', async () => {
    const error = new Error('repository failed');
    repository.save.mockRejectedValue(error);

    await expect(
      service.shareFile(USER, FILE_ID, {
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
        expiresAt: null,
      }),
    ).rejects.toBe(error);
  });

  it('authorizes and maps one page of file shares', async () => {
    const expiresAt = new Date('2026-08-10T10:00:00.000Z');
    repository.listByFileId.mockResolvedValue([
      makeGrant({
        id: 10,
        publicId: '30000000-0000-4000-8000-000000000001',
        recipientEmail: 'recipient@example.com',
        permission: 'editor',
        expiresAt,
      }),
    ]);

    const result = await service.listFileShares(USER, FILE_ID, {
      cursor: null,
      limit: 50,
    });

    expect(authorizationService.authorizeEntryByPublicId).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      entryPublicId: FILE_ID,
      action: 'share:read',
    });
    expect(repository.listByFileId).toHaveBeenCalledExactlyOnceWith({
      fileId: FILE_DB_ID,
      cursor: null,
      limit: 51,
    });
    expect(result).toStrictEqual({
      items: [
        {
          shareId: '30000000-0000-4000-8000-000000000001',
          recipientEmail: 'recipient@example.com',
          permission: 'editor',
          expiresAt: '2026-08-10T10:00:00.000Z',
        },
      ],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
  });

  it('overfetches and creates a resource-bound cursor for the next page', async () => {
    const requestCursor = encodeFileGrantListCursor({
      v: 1,
      filePublicId: FILE_ID,
      recipientEmail: 'before@example.com',
      grantDbId: 5,
    });
    repository.listByFileId.mockResolvedValue([
      makeGrant({
        id: 10,
        publicId: '30000000-0000-4000-8000-000000000001',
        recipientEmail: 'first@example.com',
      }),
      makeGrant({
        id: 11,
        publicId: '30000000-0000-4000-8000-000000000002',
        recipientEmail: 'second@example.com',
      }),
    ]);

    const result = await service.listFileShares(USER, FILE_ID, {
      cursor: requestCursor,
      limit: 1,
    });

    expect(repository.listByFileId).toHaveBeenCalledExactlyOnceWith({
      fileId: FILE_DB_ID,
      cursor: {
        recipientEmail: 'before@example.com',
        grantDbId: 5,
      },
      limit: 2,
    });
    expect(result.items.map((share) => share.recipientEmail)).toEqual(['first@example.com']);
    expect(result.page.hasMore).toBe(true);
    expect(result.page.nextCursor).not.toBeNull();
    expect(decodeFileGrantListCursor(result.page.nextCursor!)).toStrictEqual({
      v: 1,
      filePublicId: FILE_ID,
      recipientEmail: 'first@example.com',
      grantDbId: 10,
    });
  });

  it('rejects a cursor issued for another file before authorization', async () => {
    const cursor = encodeFileGrantListCursor({
      v: 1,
      filePublicId: OTHER_FILE_ID,
      recipientEmail: 'recipient@example.com',
      grantDbId: 10,
    });

    await expect(
      service.listFileShares(USER, FILE_ID, {
        cursor,
        limit: 50,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_cursor',
    });

    expect(authorizationService.authorizeEntryByPublicId).not.toHaveBeenCalled();
    expect(repository.listByFileId).not.toHaveBeenCalled();
  });

  it('does not list grants when share visibility authorization is denied', async () => {
    const error = new AppError('entry_not_found');
    authorizationService.authorizeEntryByPublicId.mockRejectedValue(error);

    await expect(
      service.listFileShares(USER, FILE_ID, {
        cursor: null,
        limit: 50,
      }),
    ).rejects.toBe(error);

    expect(repository.listByFileId).not.toHaveBeenCalled();
  });

  it('delegates file share revocation to the transaction-bound repository operation', async () => {
    const shareId = '30000000-0000-4000-8000-000000000001';

    await service.revokeFileShare(USER, FILE_ID, shareId);

    expect(repository.revoke).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      filePublicId: FILE_ID,
      grantPublicId: shareId,
      revokedAt: NOW,
    });
  });

  it('updates a permission while preserving an omitted expiry', async () => {
    const shareId = '30000000-0000-4000-8000-000000000001';
    const expiresAt = new Date('2026-08-10T10:00:00.000Z');
    repository.update.mockResolvedValue(
      makeGrant({
        id: 10,
        publicId: shareId,
        recipientEmail: 'recipient@example.com',
        permission: 'editor',
        expiresAt,
      }),
    );

    const result = await service.updateFileShare(USER, FILE_ID, shareId, {
      permission: 'editor',
    });

    expect(repository.update).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      filePublicId: FILE_ID,
      grantPublicId: shareId,
      permission: 'editor',
      expiresAt: undefined,
      updatedAt: NOW,
    });
    expect(result).toStrictEqual({
      shareId,
      recipientEmail: 'recipient@example.com',
      permission: 'editor',
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('forwards a null expiry to clear it', async () => {
    const shareId = '30000000-0000-4000-8000-000000000001';
    repository.update.mockResolvedValue(
      makeGrant({
        id: 10,
        publicId: shareId,
        recipientEmail: 'recipient@example.com',
        expiresAt: null,
      }),
    );

    const result = await service.updateFileShare(USER, FILE_ID, shareId, {
      expiresAt: null,
    });

    expect(repository.update).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      filePublicId: FILE_ID,
      grantPublicId: shareId,
      permission: undefined,
      expiresAt: null,
      updatedAt: NOW,
    });
    expect(result.expiresAt).toBeNull();
  });

  it.each([
    ['equal to the current time', NOW],
    ['before the current time', new Date(NOW.getTime() - 1)],
  ])('rejects an updated expiry %s before calling the repository', async (_case, expiresAt) => {
    await expect(
      service.updateFileShare(USER, FILE_ID, '30000000-0000-4000-8000-000000000001', {
        expiresAt,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_grant_expiry',
    });

    expect(repository.update).not.toHaveBeenCalled();
  });

  it('reports a missing file share returned by the repository', async () => {
    repository.update.mockResolvedValue(null);

    await expect(
      service.updateFileShare(USER, FILE_ID, '30000000-0000-4000-8000-000000000001', {
        permission: 'editor',
      }),
    ).rejects.toMatchObject({
      code: 'file_share_not_found',
    });
  });

  it('maps an active shared file and its viewer capabilities', async () => {
    const expiresAt = new Date('2026-08-10T10:00:00.000Z');
    repository.listSharedFiles.mockResolvedValue([
      makeSharedFileRecord({
        grant: {
          permission: 'viewer',
          expiresAt,
        },
      }),
    ]);

    const result = await service.listSharedFiles(USER, {
      cursor: null,
      limit: 50,
    });

    expect(repository.listSharedFiles).toHaveBeenCalledExactlyOnceWith({
      recipientUserId: USER.id,
      listedAt: NOW,
      cursor: null,
      limit: 51,
    });
    expect(result).toStrictEqual({
      items: [
        {
          kind: 'file',
          id: FILE_ID,
          name: 'Shared file.txt',
          contentType: 'text/plain',
          sizeBytes: 512,
          updatedAt: '2026-07-31T12:00:00.000Z',
          owner: {
            email: 'other-owner@example.com',
            firstName: 'Other',
            lastName: 'Owner',
          },
          expiresAt: expiresAt.toISOString(),
          access: {
            accessLevel: 'viewer',
            capabilities: {
              download: true,
              rename: false,
              replaceContent: false,
              move: false,
              delete: false,
              manageSharing: false,
            },
          },
        },
      ],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
  });

  it('overfetches shared files and encodes the last returned record in the next cursor', async () => {
    const requestCursor = encodeSharedFileListCursor({
      v: 1,
      sortName: 'before.txt',
      entryId: 40,
    });
    repository.listSharedFiles.mockResolvedValue([
      makeSharedFileRecord({
        grant: {
          permission: 'editor',
          expiresAt: null,
        },
        cursor: {
          sortName: 'shared file.txt',
          entryId: 42,
        },
      }),
      makeSharedFileRecord({
        file: {
          id: OTHER_FILE_ID,
          name: 'Second file.txt',
          contentType: 'text/plain',
          sizeBytes: 128,
          updatedAt: NOW,
        },
        cursor: {
          sortName: 'second file.txt',
          entryId: 43,
        },
      }),
    ]);

    const result = await service.listSharedFiles(USER, {
      cursor: requestCursor,
      limit: 1,
    });

    expect(repository.listSharedFiles).toHaveBeenCalledExactlyOnceWith({
      recipientUserId: USER.id,
      listedAt: NOW,
      cursor: {
        v: 1,
        sortName: 'before.txt',
        entryId: 40,
      },
      limit: 2,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.access).toStrictEqual({
      accessLevel: 'editor',
      capabilities: {
        download: true,
        rename: true,
        replaceContent: true,
        move: false,
        delete: false,
        manageSharing: false,
      },
    });
    expect(result.page.hasMore).toBe(true);
    expect(result.page.nextCursor).not.toBeNull();
    expect(decodeSharedFileListCursor(result.page.nextCursor!)).toStrictEqual({
      v: 1,
      sortName: 'shared file.txt',
      entryId: 42,
    });
  });

  it('rejects an invalid shared-file cursor before querying the repository', async () => {
    await expect(
      service.listSharedFiles(USER, {
        cursor: 'not-a-valid-cursor',
        limit: 50,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_cursor',
    });

    expect(repository.listSharedFiles).not.toHaveBeenCalled();
  });
});

function makeGrant(
  overrides: Pick<FileGrant, 'id' | 'publicId' | 'recipientEmail'> & Partial<FileGrant>,
): FileGrant {
  const { id, publicId, recipientEmail, ...optionalOverrides } = overrides;

  return {
    id,
    publicId,
    fileId: FILE_DB_ID,
    recipientUserId: null,
    recipientEmail,
    createdByUserId: USER.id,
    permission: 'viewer',
    expiresAt: null,
    activationDeadline: new Date('2026-08-03T10:00:00.000Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...optionalOverrides,
  };
}

function makeSharedFileRecord(overrides: Partial<SharedFileRecord> = {}): SharedFileRecord {
  return {
    file: {
      id: FILE_ID,
      name: 'Shared file.txt',
      contentType: 'text/plain',
      sizeBytes: 512,
      updatedAt: new Date('2026-07-31T12:00:00.000Z'),
    },
    owner: {
      id: 2,
      email: 'other-owner@example.com',
      firstName: 'Other',
      lastName: 'Owner',
    },
    grant: {
      permission: 'viewer',
      expiresAt: null,
    },
    cursor: {
      sortName: 'shared file.txt',
      entryId: FILE_DB_ID,
    },
    ...overrides,
  };
}
