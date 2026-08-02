import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthorizationService } from '../../src/authorization/authorization-service.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type { FileGrantRepository } from '../../src/sharing/file-grant-repository.js';
import {
  decodeFileGrantListCursor,
  encodeFileGrantListCursor,
} from '../../src/sharing/file-grant-list-cursor.js';
import type { FileGrant } from '../../src/sharing/file-grant.js';
import { FileSharingService } from '../../src/sharing/file-sharing-service.js';
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
  username: 'owner',
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
    service = new FileSharingService(authorizationService, repository);

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
