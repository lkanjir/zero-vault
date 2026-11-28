import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuditRepository } from '../../src/audit/audit-repository.js';
import { AuthorizationPolicy } from '../../src/authorization/authorization-policy.js';
import { EntryAccessMapper } from '../../src/authorization/entry-access-mapper.js';
import type { AuthorizedEntry, EntryAuthorizer } from '../../src/authorization/entry-authorizer.js';
import type { TransactionContext, UnitOfWork } from '../../src/db/unit-of-work.js';
import { decodeCursor, encodeCursor } from '../../src/entry/entry-list-cursor.js';
import type { EntryRepository } from '../../src/entry/entry-repository.js';
import { EntryService } from '../../src/entry/entry-service.js';
import type { Entry } from '../../src/entry/entry.js';
import { MAX_FOLDER_TREE_DEPTH } from '../../src/folder/validation-schemas.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type { User } from '../../src/user/user.js';
import { createFakeUnitOfWork } from '../helpers/fake-unit-of-work.js';

const NOW = new Date('2026-07-28T10:00:00.000Z');
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

describe('EntryService', () => {
  let tx: TransactionContext;
  let unitOfWork: UnitOfWork;
  let runSpy: ReturnType<typeof createFakeUnitOfWork>['runSpy'];
  let entryAuthorizer: MockProxy<EntryAuthorizer>;
  let repository: MockProxy<EntryRepository>;
  let auditRepository: MockProxy<AuditRepository>;
  let service: EntryService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ({ tx, unitOfWork, runSpy } = createFakeUnitOfWork());
    entryAuthorizer = mock<EntryAuthorizer>();
    repository = mock<EntryRepository>();
    auditRepository = mock<AuditRepository>();
    service = new EntryService(
      unitOfWork,
      entryAuthorizer,
      repository,
      auditRepository,
      new EntryAccessMapper(new AuthorizationPolicy()),
    );
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
      search: null,
      kind: null,
      sort: 'name-asc',
    });

    expect(repository.getEntries).toHaveBeenCalledExactlyOnceWith({
      ownerId: USER.id,
      parentId,
      cursor: null,
      limit: 3,
      search: null,
      kind: null,
      sort: 'name-asc',
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
      v: 2,
      parentId,
      search: null,
      kind: null,
      sort: 'name-asc',
      kindRank: 0,
      sortName: 'beta',
      updatedAt: NOW.toISOString(),
      entryId: 11,
    });
  });

  it('rejects a cursor issued for another listing query before querying the repository', async () => {
    const parentId = '20000000-0000-4000-8000-000000000001';
    const cursor = encodeCursor({
      v: 2,
      parentId,
      search: 'report',
      kind: 'file',
      sort: 'updated-desc',
      kindRank: 0,
      sortName: 'alpha',
      updatedAt: NOW.toISOString(),
      entryId: 10,
    });

    const mismatchedRequests = [
      {
        parentId: '20000000-0000-4000-8000-000000000002',
        search: 'report',
        kind: 'file' as const,
        sort: 'updated-desc' as const,
      },
      {
        parentId,
        search: 'invoice',
        kind: 'file' as const,
        sort: 'updated-desc' as const,
      },
      {
        parentId,
        search: 'report',
        kind: 'folder' as const,
        sort: 'updated-desc' as const,
      },
      {
        parentId,
        search: 'report',
        kind: 'file' as const,
        sort: 'name-asc' as const,
      },
    ];

    for (const request of mismatchedRequests) {
      await expect(
        service.listEntries(USER, {
          ...request,
          cursor,
          limit: 50,
        }),
      ).rejects.toMatchObject({
        code: 'invalid_cursor',
      });
    }

    expect(repository.getEntries).not.toHaveBeenCalled();
  });

  it('authorizes parent, creates a folder, and records audit inside one transaction', async () => {
    const parentPublicId = '20000000-0000-4000-8000-000000000009';
    const folderPublicId = '20000000-0000-4000-8000-000000000010';
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(9);
    repository.getFolderDepth.mockResolvedValue(1);
    repository.createFolder.mockResolvedValue({
      id: 10,
      publicId: folderPublicId,
      ownerId: USER.id,
      parentId: 9,
      kind: 'folder',
      name: 'Projects',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });

    const result = await service.createFolder(USER, {
      parentId: parentPublicId,
      name: 'Projects',
    });

    expect(runSpy).toHaveBeenCalledOnce();
    expect(entryAuthorizer.authorizeParentForCreate).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        ownerId: USER.id,
        parentPublicId,
      },
      tx,
    );
    expect(repository.createFolder).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: USER.id,
        parentId: 9,
        name: 'Projects',
      },
      tx,
    );
    expect(auditRepository.record).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: 10,
        entryNameSnapshot: 'Projects',
        action: 'folder.created',
        occurredAt: NOW,
      },
      tx,
    );
    expect(result).toStrictEqual({
      kind: 'folder',
      id: folderPublicId,
      name: 'Projects',
      updatedAt: NOW.toISOString(),
    });
  });

  it('updates a folder, checks move cycles, records rename/move audits, and returns access capabilities', async () => {
    const entryPublicId = '20000000-0000-4000-8000-000000000010';
    const destParentPublicId = '20000000-0000-4000-8000-000000000020';
    const sourceEntry = makeEntry({
      id: 10,
      publicId: entryPublicId,
      kind: 'folder',
      name: 'Old',
      parentId: 5,
    });
    const updatedEntry = {
      ...sourceEntry,
      name: 'New',
      parentId: 20,
      updatedAt: NOW,
    };

    entryAuthorizer.authorizeForUpdate.mockResolvedValue(makeAuthorizedEntry(sourceEntry));
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(20);
    repository.getFolderDepth.mockResolvedValue(2);
    repository.getFolderSubtreeHeight.mockResolvedValue(1);
    repository.updateEntry.mockResolvedValue({
      entry: updatedEntry,
      listedEntry: {
        kind: 'folder',
        id: entryPublicId,
        name: 'New',
        updatedAt: NOW,
      },
    });
    repository.resolveParentContext
      .mockResolvedValueOnce({ publicId: '20000000-0000-4000-8000-000000000005', name: 'Source' })
      .mockResolvedValueOnce({ publicId: destParentPublicId, name: 'Destination' });

    const response = await service.updateEntry(USER, entryPublicId, {
      name: 'New',
      parentId: destParentPublicId,
    });

    expect(runSpy).toHaveBeenCalledOnce();
    expect(entryAuthorizer.authorizeForUpdate).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        entryPublicId,
        actions: ['entry:rename', 'entry:move'],
      },
      tx,
    );
    expect(repository.assertFolderCanMove).toHaveBeenCalledExactlyOnceWith(10, 20, tx);
    expect(repository.updateEntry).toHaveBeenCalledExactlyOnceWith(
      {
        entryId: 10,
        ownerId: USER.id,
        name: 'New',
        parentId: 20,
        updatedAt: NOW,
      },
      tx,
    );
    expect(auditRepository.record).toHaveBeenNthCalledWith(
      1,
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: 10,
        entryNameSnapshot: 'New',
        action: 'entry.renamed',
        details: { previousName: 'Old' },
        occurredAt: NOW,
      },
      tx,
    );
    expect(auditRepository.record).toHaveBeenNthCalledWith(
      2,
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: 10,
        entryNameSnapshot: 'New',
        action: 'entry.moved',
        details: {
          sourceParentId: '20000000-0000-4000-8000-000000000005',
          sourceParentName: 'Source',
          destinationParentId: destParentPublicId,
          destinationParentName: 'Destination',
        },
        occurredAt: NOW,
      },
      tx,
    );
    expect(response).toStrictEqual({
      kind: 'folder',
      id: entryPublicId,
      name: 'New',
      updatedAt: NOW.toISOString(),
      access: {
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
    });
  });

  it('returns editor access capabilities when a shared editor renames a file', async () => {
    const filePublicId = '20000000-0000-4000-8000-000000000011';
    const sourceEntry = makeEntry({
      id: 11,
      publicId: filePublicId,
      ownerId: 99,
      kind: 'file',
      name: 'original.txt',
      parentId: null,
    });
    const updatedEntry = { ...sourceEntry, name: 'renamed.txt', updatedAt: NOW };

    entryAuthorizer.authorizeForUpdate.mockResolvedValue({
      entry: sourceEntry,
      context: {
        scope: 'entry',
        actor: { userId: USER.id },
        resource: {
          id: sourceEntry.id,
          ownerId: 99,
          kind: 'file',
          deletedAt: null,
        },
        relationship: {
          grant: { permission: 'editor', expiresAt: null },
        },
        environment: { now: NOW },
      },
    });
    repository.updateEntry.mockResolvedValue({
      entry: updatedEntry,
      listedEntry: {
        kind: 'file',
        id: filePublicId,
        name: 'renamed.txt',
        contentType: 'text/plain',
        sizeBytes: 12,
        updatedAt: NOW,
      },
    });

    const response = await service.updateEntry(USER, filePublicId, { name: 'renamed.txt' });

    expect(response).toStrictEqual({
      kind: 'file',
      id: filePublicId,
      name: 'renamed.txt',
      contentType: 'text/plain',
      sizeBytes: 12,
      updatedAt: NOW.toISOString(),
      access: {
        accessLevel: 'editor',
        capabilities: {
          download: true,
          rename: true,
          replaceContent: true,
          move: false,
          delete: false,
          manageSharing: false,
        },
      },
    });
    expect(auditRepository.record).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: 99,
        actorUserId: USER.id,
        entryId: 11,
        entryNameSnapshot: 'renamed.txt',
        action: 'entry.renamed',
        details: { previousName: 'original.txt' },
        occurredAt: NOW,
      },
      tx,
    );
  });

  it('authorizes, deletes an entry, and records audit inside one transaction', async () => {
    const entryId = '20000000-0000-4000-8000-000000000001';
    const entry = makeEntry({ id: 10, publicId: entryId, kind: 'file', name: 'report.txt' });
    entryAuthorizer.authorizeForUpdate.mockResolvedValue(makeAuthorizedEntry(entry));

    await service.deleteEntry(USER, entryId);

    expect(runSpy).toHaveBeenCalledOnce();
    expect(entryAuthorizer.authorizeForUpdate).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER.id,
        entryPublicId: entryId,
        actions: ['entry:delete'],
      },
      tx,
    );
    expect(repository.deleteEntry).toHaveBeenCalledExactlyOnceWith({ entry, deletedAt: NOW }, tx);
    expect(auditRepository.record).toHaveBeenCalledExactlyOnceWith(
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: 10,
        entryNameSnapshot: 'report.txt',
        action: 'entry.deleted',
        occurredAt: NOW,
      },
      tx,
    );
  });

  it('ensures folder tree, merges existing folders without re-auditing, and maps case-insensitive siblings', async () => {
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(null);

    const existingPhotos = {
      ...makeEntry({ id: 20, publicId: '20000000-0000-4000-8000-000000000020', name: 'Photos' }),
      kind: 'folder' as const,
    };
    const createdSummer = {
      ...makeEntry({
        id: 21,
        parentId: 20,
        publicId: '20000000-0000-4000-8000-000000000021',
        name: 'Summer',
      }),
      kind: 'folder' as const,
    };
    const createdWinter = {
      ...makeEntry({
        id: 22,
        parentId: 20,
        publicId: '20000000-0000-4000-8000-000000000022',
        name: 'Winter',
      }),
      kind: 'folder' as const,
    };

    repository.findOrCreateFolder.mockImplementation((command) => {
      if (command.parentId === null && command.name.toLowerCase() === 'photos') {
        return Promise.resolve({ folder: existingPhotos, created: false });
      }
      if (command.parentId === 20 && command.name === 'Summer') {
        return Promise.resolve({ folder: createdSummer, created: true });
      }
      if (command.parentId === 20 && command.name === 'Winter') {
        return Promise.resolve({ folder: createdWinter, created: true });
      }
      return Promise.reject(new Error(`Unexpected folder call: ${command.relativePath}`));
    });

    const result = await service.ensureFolderTree(USER, {
      parentId: null,
      paths: ['Photos/Summer', 'photos/Winter'],
    });

    expect(runSpy).toHaveBeenCalledOnce();
    expect(result).toStrictEqual({
      folders: {
        Photos: existingPhotos.publicId,
        'Photos/Summer': createdSummer.publicId,
        photos: existingPhotos.publicId,
        'photos/Winter': createdWinter.publicId,
      },
    });
    expect(repository.findOrCreateFolder).toHaveBeenCalledTimes(3);
    expect(auditRepository.record).toHaveBeenCalledTimes(2);
    expect(auditRepository.record).toHaveBeenNthCalledWith(
      1,
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: 21,
        entryNameSnapshot: 'Summer',
        action: 'folder.created',
        occurredAt: NOW,
      },
      tx,
    );
    expect(auditRepository.record).toHaveBeenNthCalledWith(
      2,
      {
        ownerId: USER.id,
        actorUserId: USER.id,
        entryId: 22,
        entryNameSnapshot: 'Winter',
        action: 'folder.created',
        occurredAt: NOW,
      },
      tx,
    );
  });

  it('rejects ensureFolderTree when parent depth plus relative depth exceeds the limit', async () => {
    const parentPublicId = '20000000-0000-4000-8000-000000000099';
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(99);
    repository.getFolderDepth.mockResolvedValue(MAX_FOLDER_TREE_DEPTH - 1);

    await expect(
      service.ensureFolderTree(USER, {
        parentId: parentPublicId,
        paths: ['a/b'],
      }),
    ).rejects.toThrow(AppError);

    await expect(
      service.ensureFolderTree(USER, {
        parentId: parentPublicId,
        paths: ['a/b'],
      }),
    ).rejects.toMatchObject({ code: 'folder_depth_limit_exceeded' });

    expect(repository.findOrCreateFolder).not.toHaveBeenCalled();
    expect(auditRepository.record).not.toHaveBeenCalled();
  });

  it('preserves Object.prototype key names like __proto__ and constructor as own properties in the response map', async () => {
    const protoFolder = {
      id: 30,
      publicId: '20000000-0000-4000-8000-000000000030',
      ownerId: USER.id,
      parentId: null,
      kind: 'folder' as const,
      name: '__proto__',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
    const ctorFolder = {
      id: 31,
      publicId: '20000000-0000-4000-8000-000000000031',
      ownerId: USER.id,
      parentId: 30,
      kind: 'folder' as const,
      name: 'constructor',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };

    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(null);
    repository.findOrCreateFolder
      .mockResolvedValueOnce({ folder: protoFolder, created: true })
      .mockResolvedValueOnce({ folder: ctorFolder, created: true });

    const result = await service.ensureFolderTree(USER, {
      parentId: null,
      paths: ['__proto__/constructor'],
    });

    expect(Object.hasOwn(result.folders, '__proto__')).toBe(true);
    expect(Object.hasOwn(result.folders, '__proto__/constructor')).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual({
      folders: Object.fromEntries([
        ['__proto__', protoFolder.publicId],
        ['__proto__/constructor', ctorFolder.publicId],
      ]),
    });
  });

  it('rejects createFolder when parent folder is already at max depth', async () => {
    const parentPublicId = '20000000-0000-4000-8000-000000000009';
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(9);
    repository.getFolderDepth.mockResolvedValue(MAX_FOLDER_TREE_DEPTH);

    await expect(
      service.createFolder(USER, {
        parentId: parentPublicId,
        name: 'TooDeep',
      }),
    ).rejects.toMatchObject({ code: 'folder_depth_limit_exceeded' });

    expect(repository.createFolder).not.toHaveBeenCalled();
    expect(auditRepository.record).not.toHaveBeenCalled();
  });

  it('rejects moving a folder when target parent depth plus subtree height exceeds max depth', async () => {
    const entryPublicId = '20000000-0000-4000-8000-000000000010';
    const destParentPublicId = '20000000-0000-4000-8000-000000000020';
    const sourceEntry = makeEntry({
      id: 10,
      publicId: entryPublicId,
      kind: 'folder',
      name: 'SubtreeRoot',
      parentId: null,
    });

    entryAuthorizer.authorizeForUpdate.mockResolvedValue(makeAuthorizedEntry(sourceEntry));
    entryAuthorizer.authorizeParentForCreate.mockResolvedValue(20);
    repository.getFolderDepth.mockResolvedValue(MAX_FOLDER_TREE_DEPTH - 1);
    repository.getFolderSubtreeHeight.mockResolvedValue(2);

    await expect(
      service.updateEntry(USER, entryPublicId, { parentId: destParentPublicId }),
    ).rejects.toMatchObject({ code: 'folder_depth_limit_exceeded' });

    expect(repository.assertFolderCanMove).toHaveBeenCalledExactlyOnceWith(10, 20, tx);
    expect(repository.updateEntry).not.toHaveBeenCalled();
    expect(auditRepository.record).not.toHaveBeenCalled();
  });
});

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 10,
    publicId: '20000000-0000-4000-8000-000000000010',
    ownerId: USER.id,
    parentId: null,
    kind: 'folder',
    name: 'Folder',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeAuthorizedEntry(entry: Entry): AuthorizedEntry {
  return {
    entry,
    context: {
      scope: 'entry',
      actor: { userId: USER.id },
      resource: {
        id: entry.id,
        ownerId: entry.ownerId,
        kind: entry.kind,
        deletedAt: entry.deletedAt,
      },
      relationship: { grant: null },
      environment: { now: NOW },
    },
  };
}

function makeFolderRecord(entryId: number, name: string) {
  return {
    cursor: {
      kindRank: 0 as const,
      sortName: name.toLowerCase(),
      updatedAt: NOW.toISOString(),
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
      updatedAt: NOW.toISOString(),
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
