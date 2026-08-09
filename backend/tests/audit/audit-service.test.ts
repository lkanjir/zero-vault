import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import {
  decodeAuditEventListCursor,
  encodeAuditEventListCursor,
} from '../../src/audit/audit-event-list-cursor.js';
import type { AuditEventRecord, AuditRepository } from '../../src/audit/audit-repository.js';
import { AuditService } from '../../src/audit/audit-service.js';
import type { AuthorizationService } from '../../src/authorization/authorization-service.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type { User } from '../../src/user/user.js';

const NOW = new Date('2026-08-09T12:00:00.000Z');
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

describe('AuditService', () => {
  let authorizationService: MockProxy<AuthorizationService>;
  let repository: MockProxy<AuditRepository>;
  let service: AuditService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    authorizationService = mock<AuthorizationService>();
    repository = mock<AuditRepository>();
    service = new AuditService(authorizationService, repository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('authorizes the drive owner and returns a stable cursor page', async () => {
    const records = [
      makeRecord(30, 'entry.deleted', new Date('2026-08-09T11:00:00.000Z'), {
        deletedAt: NOW,
      }),
      makeRecord(29, 'entry.renamed', new Date('2026-08-09T10:00:00.000Z')),
      makeRecord(28, 'file.uploaded', new Date('2026-08-09T09:00:00.000Z')),
    ];
    repository.listEvents.mockResolvedValue(records);

    const result = await service.listEvents(USER, {
      cursor: null,
      limit: 2,
      search: 'report',
    });

    expect(authorizationService.authorizeDriveRoot).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      ownerId: USER.id,
      action: 'audit:read',
    });
    expect(repository.listEvents).toHaveBeenCalledExactlyOnceWith({
      ownerId: USER.id,
      search: 'report',
      cursor: null,
      limit: 3,
    });
    expect(result.items).toStrictEqual([
      {
        id: records[0]!.id,
        action: 'entry.deleted',
        occurredAt: '2026-08-09T11:00:00.000Z',
        actor: records[0]!.actor,
        entry: {
          kind: 'file',
          name: 'report.txt',
          deleted: true,
        },
        details: {},
      },
      {
        id: records[1]!.id,
        action: 'entry.renamed',
        occurredAt: '2026-08-09T10:00:00.000Z',
        actor: records[1]!.actor,
        entry: {
          kind: 'file',
          name: 'report.txt',
          deleted: false,
        },
        details: {},
      },
    ]);
    expect(result.page).toMatchObject({
      limit: 2,
      hasMore: true,
    });
    expect(result.page.nextCursor).not.toBeNull();
    expect(decodeAuditEventListCursor(result.page.nextCursor!)).toStrictEqual({
      v: 1,
      search: 'report',
      occurredAt: '2026-08-09T10:00:00.000Z',
      auditEventId: 29,
    });
  });

  it('decodes a matching cursor before querying the repository', async () => {
    const cursor = encodeAuditEventListCursor({
      v: 1,
      search: null,
      occurredAt: '2026-08-08T10:00:00.000Z',
      auditEventId: 20,
    });
    repository.listEvents.mockResolvedValue([]);

    const result = await service.listEvents(USER, {
      cursor,
      limit: 50,
      search: null,
    });

    expect(repository.listEvents).toHaveBeenCalledExactlyOnceWith({
      ownerId: USER.id,
      search: null,
      cursor: {
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
        auditEventId: 20,
      },
      limit: 51,
    });
    expect(result).toStrictEqual({
      items: [],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
  });

  it('rejects a cursor issued for another search before querying the repository', async () => {
    const cursor = encodeAuditEventListCursor({
      v: 1,
      search: 'report',
      occurredAt: '2026-08-08T10:00:00.000Z',
      auditEventId: 20,
    });

    await expect(
      service.listEvents(USER, {
        cursor,
        limit: 50,
        search: 'invoice',
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor' });

    expect(repository.listEvents).not.toHaveBeenCalled();
  });

  it('does not query events when audit authorization is denied', async () => {
    const error = new AppError('authorization_denied');
    authorizationService.authorizeDriveRoot.mockImplementation(() => {
      throw error;
    });

    await expect(
      service.listEvents(USER, {
        cursor: null,
        limit: 50,
        search: null,
      }),
    ).rejects.toBe(error);

    expect(repository.listEvents).not.toHaveBeenCalled();
  });

  it('returns owner statistics for the rolling 30-day period', async () => {
    repository.getStatistics.mockResolvedValue({
      total: 20,
      entryChanges: 11,
      downloadRequests: 4,
      sharingChanges: 5,
    });

    const result = await service.getStatistics(USER);

    expect(authorizationService.authorizeDriveRoot).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      ownerId: USER.id,
      action: 'audit:read',
    });
    expect(repository.getStatistics).toHaveBeenCalledExactlyOnceWith({
      ownerId: USER.id,
      from: new Date('2026-07-10T12:00:00.000Z'),
      to: NOW,
    });
    expect(result).toStrictEqual({
      period: {
        from: '2026-07-10T12:00:00.000Z',
        to: NOW.toISOString(),
      },
      total: 20,
      entryChanges: 11,
      downloadRequests: 4,
      sharingChanges: 5,
    });
  });
});

function makeRecord(
  auditEventId: number,
  action: AuditEventRecord['action'],
  occurredAt: Date,
  overrides: {
    deletedAt?: Date | null;
  } = {},
): AuditEventRecord {
  return {
    id: `30000000-0000-4000-8000-${auditEventId.toString().padStart(12, '0')}`,
    action,
    details: {},
    occurredAt,
    actor: {
      firstName: 'Test',
      lastName: 'Actor',
      email: 'actor@example.com',
    },
    entry: {
      kind: 'file',
      nameSnapshot: 'report.txt',
      deletedAt: overrides.deletedAt ?? null,
    },
    cursor: {
      occurredAt,
      auditEventId,
    },
  };
}
