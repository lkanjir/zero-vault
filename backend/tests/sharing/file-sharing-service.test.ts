import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthorizationService } from '../../src/authorization/authorization-service.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type { FileGrantRepository } from '../../src/sharing/file-grant-repository.js';
import { FileSharingService } from '../../src/sharing/file-sharing-service.js';
import type { User } from '../../src/user/user.js';

const NOW = new Date('2026-08-01T10:00:00.000Z');
const FILE_ID = '20000000-0000-4000-8000-000000000001';
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
});
