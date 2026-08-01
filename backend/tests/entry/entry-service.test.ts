import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { EntryAccessMapper } from '../../src/authorization/entry-access-mapper.js';
import { AuthorizationPolicy } from '../../src/authorization/authorization-policy.js';
import { decodeCursor, encodeCursor } from '../../src/entry/entry-list-cursor.js';
import type { EntryRepository } from '../../src/entry/entry-repository.js';
import { EntryService } from '../../src/entry/entry-service.js';
import type { User } from '../../src/user/user.js';

const NOW = new Date('2026-07-28T10:00:00.000Z');
const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  username: 'test',
  email: 'test@example.com',
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

describe('EntryService', () => {
  let repository: MockProxy<EntryRepository>;
  let service: EntryService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    repository = mock<EntryRepository>();
    service = new EntryService(repository, new EntryAccessMapper(new AuthorizationPolicy()));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a stable cursor page and preserves the resolved folder path', async () => {
    const parentId = '20000000-0000-4000-8000-000000000001';
    repository.getEntries.mockResolvedValue({
      path: [{ id: parentId, name: 'Documents' }],
      entries: [
        makeFolderRecord(10, 'Alpha'),
        makeFolderRecord(11, 'Beta'),
        makeFileRecord(12, 'report.txt'),
      ],
    });

    const response = await service.listEntries(USER, {
      parentId,
      cursor: null,
      limit: 2,
    });

    expect(repository.getEntries).toHaveBeenCalledExactlyOnceWith({
      ownerId: USER.id,
      parentId,
      cursor: null,
      limit: 3,
    });
    expect(response.items.map((entry) => entry.name)).toStrictEqual(['Alpha', 'Beta']);
    expect(response.items.map((entry) => entry.access)).toStrictEqual([
      {
        accessLevel: 'owner',
        capabilities: {
          download: true,
          rename: true,
          replaceContent: false,
          move: true,
          delete: true,
          manageSharing: false,
        },
      },
      {
        accessLevel: 'owner',
        capabilities: {
          download: true,
          rename: true,
          replaceContent: false,
          move: true,
          delete: true,
          manageSharing: false,
        },
      },
    ]);
    expect(response.path).toStrictEqual([{ id: parentId, name: 'Documents' }]);
    expect(response.page).toMatchObject({
      limit: 2,
      hasMore: true,
    });
    expect(response.page.nextCursor).not.toBeNull();
    expect(decodeCursor(response.page.nextCursor!)).toStrictEqual({
      v: 1,
      parentId,
      kindRank: 0,
      sortName: 'beta',
      entryId: 11,
    });
  });

  it('rejects a cursor issued for another parent before querying the repository', async () => {
    const cursor = encodeCursor({
      v: 1,
      parentId: '20000000-0000-4000-8000-000000000001',
      kindRank: 0,
      sortName: 'alpha',
      entryId: 10,
    });

    await expect(
      service.listEntries(USER, {
        parentId: '20000000-0000-4000-8000-000000000002',
        cursor,
        limit: 50,
      }),
    ).rejects.toMatchObject({
      code: 'cursor_parent_mismatch',
    });
    expect(repository.getEntries).not.toHaveBeenCalled();
  });

  it('delegates deletion with the actor identity', async () => {
    const entryId = '20000000-0000-4000-8000-000000000001';

    await service.deleteEntry(USER, entryId);

    expect(repository.deleteEntry).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER.id,
      entryId,
    });
  });
});

function makeFolderRecord(entryId: number, name: string) {
  return {
    cursor: {
      kindRank: 0 as const,
      sortName: name.toLowerCase(),
      entryId,
    },
    entry: {
      kind: 'folder' as const,
      id: `20000000-0000-4000-8000-${entryId.toString().padStart(12, '0')}`,
      name,
      updatedAt: NOW,
    },
  };
}

function makeFileRecord(entryId: number, name: string) {
  return {
    cursor: {
      kindRank: 1 as const,
      sortName: name.toLowerCase(),
      entryId,
    },
    entry: {
      kind: 'file' as const,
      id: `20000000-0000-4000-8000-${entryId.toString().padStart(12, '0')}`,
      name,
      contentType: 'text/plain',
      sizeBytes: 12,
      updatedAt: NOW,
    },
  };
}
