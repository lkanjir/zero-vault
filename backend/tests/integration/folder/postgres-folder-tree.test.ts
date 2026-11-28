import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresAuditRepository } from '../../../src/audit/postgres-audit-repository.js';
import { AuthorizationPolicy } from '../../../src/authorization/authorization-policy.js';
import { AuthorizationService } from '../../../src/authorization/authorization-service.js';
import { EntryAccessMapper } from '../../../src/authorization/entry-access-mapper.js';
import { PostgresAuthorizationContextResolver } from '../../../src/authorization/postgres-authorization-context-resolver.js';
import { PostgresEntryAuthorizer } from '../../../src/authorization/postgres-entry-authorizer.js';
import { createDatabase, type Database } from '../../../src/db/db-client.js';
import { auditEvents, entries, files, users } from '../../../src/db/schema.js';
import { DrizzleUnitOfWork } from '../../../src/db/unit-of-work.js';
import { EntryService } from '../../../src/entry/entry-service.js';
import { PostgresEntryRepository } from '../../../src/entry/postgres-entry-repository.js';
import { PostgresFolderDownloadRepository } from '../../../src/folder/download/postgres-folder-download-repository.js';
import { MAX_FOLDER_TREE_DEPTH } from '../../../src/folder/validation-schemas.js';
import type { User } from '../../../src/user/user.js';

const OWNER_ISSUER = 'https://issuer.example.test/realms/zero-vault';

describe('PostgresEntryRepository and EntryService.ensureFolderTree', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let entryService: EntryService;
  let folderDownloadRepository: PostgresFolderDownloadRepository;
  let unitOfWork: DrizzleUnitOfWork;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('zero_vault_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    const dbHandle = createDatabase({ connectionString: container.getConnectionUri() });
    database = dbHandle.db;
    closeDatabase = dbHandle.close;

    const authorizationPolicy = new AuthorizationPolicy();
    const authorizationService = new AuthorizationService(
      new PostgresAuthorizationContextResolver(database),
      authorizationPolicy,
    );
    unitOfWork = new DrizzleUnitOfWork(database);
    const entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    const entryRepository = new PostgresEntryRepository(database);
    const auditRepository = new PostgresAuditRepository(database);
    const accessMapper = new EntryAccessMapper(authorizationPolicy);
    folderDownloadRepository = new PostgresFolderDownloadRepository(database);

    entryService = new EntryService(
      unitOfWork,
      entryAuthorizer,
      entryRepository,
      auditRepository,
      accessMapper,
    );

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(auditEvents);
    await database.delete(files);
    await database.delete(entries);
    await database.delete(users);
  });

  afterAll(async () => {
    await closeDatabase();
    await container.stop();
  });

  it('creates nested folders, merges existing folders case-insensitively, and audits only newly created folders', async () => {
    const user = await createUser();
    const existingPhotos = await entryService.createFolder(user, {
      parentId: null,
      name: 'Photos',
    });

    const result = await entryService.ensureFolderTree(user, {
      parentId: null,
      paths: ['photos/2026/Summer', 'Photos/2026/Winter', 'EmptyFolder'],
    });

    expect(result.folders['photos']).toBe(existingPhotos.id);
    expect(result.folders['Photos']).toBe(existingPhotos.id);
    expect(result.folders['photos/2026']).toBe(result.folders['Photos/2026']);
    expect(result.folders['photos/2026/Summer']).toBeDefined();
    expect(result.folders['Photos/2026/Winter']).toBeDefined();
    expect(result.folders['EmptyFolder']).toBeDefined();

    const activeFolders = await database
      .select()
      .from(entries)
      .where(and(eq(entries.ownerId, user.id), isNull(entries.deletedAt)));
    expect(activeFolders).toHaveLength(5);

    const events = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.ownerId, user.id));
    // 1 from createFolder('Photos') + 4 newly created ('2026', 'Summer', 'Winter', 'EmptyFolder')
    expect(events).toHaveLength(5);
    expect(events.map((event) => event.entryNameSnapshot).sort()).toStrictEqual([
      '2026',
      'EmptyFolder',
      'Photos',
      'Summer',
      'Winter',
    ]);
  });

  it('rolls back the entire tree atomically when a file exists at a folder path', async () => {
    const user = await createUser();
    const existingPhotos = await entryService.createFolder(user, {
      parentId: null,
      name: 'Photos',
    });
    const [photosRow] = await database
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.publicId, existingPhotos.id));

    await database.insert(entries).values({
      ownerId: user.id,
      parentId: photosRow!.id,
      kind: 'file',
      name: 'ConflictFile',
    });

    await expect(
      entryService.ensureFolderTree(user, {
        parentId: null,
        paths: ['BrandNewRoot/Sub', 'photos/conflictfile/Nested'],
      }),
    ).rejects.toMatchObject({ code: 'folder_path_conflict' });

    const activeEntries = await database
      .select({ name: entries.name, kind: entries.kind })
      .from(entries)
      .where(and(eq(entries.ownerId, user.id), isNull(entries.deletedAt)))
      .orderBy(asc(entries.id));

    expect(activeEntries).toStrictEqual([
      { name: 'Photos', kind: 'folder' },
      { name: 'ConflictFile', kind: 'file' },
    ]);
  });

  it('ignores soft-deleted siblings and creates a new active folder', async () => {
    const user = await createUser();
    await database.insert(entries).values({
      ownerId: user.id,
      parentId: null,
      kind: 'file',
      name: 'Archive',
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await entryService.ensureFolderTree(user, {
      parentId: null,
      paths: ['Archive/2026'],
    });

    expect(result.folders['Archive']).toBeDefined();
    expect(result.folders['Archive/2026']).toBeDefined();
  });

  it('enforces max folder depth including existing parent ancestor depth', async () => {
    const user = await createUser();
    const chain = Array.from({ length: MAX_FOLDER_TREE_DEPTH - 1 }, (_, i) => `l${i + 1}`).join(
      '/',
    );
    const created = await entryService.ensureFolderTree(user, {
      parentId: null,
      paths: [chain],
    });
    const deepParentId = created.folders[chain]!;

    // Depth 63 + 1 = 64 -> allowed
    const allowed = await entryService.ensureFolderTree(user, {
      parentId: deepParentId,
      paths: ['leaf'],
    });
    expect(allowed.folders['leaf']).toBeDefined();

    // Depth 63 + 2 = 65 -> rejected
    await expect(
      entryService.ensureFolderTree(user, {
        parentId: deepParentId,
        paths: ['leaf/too-deep'],
      }),
    ).rejects.toMatchObject({ code: 'folder_depth_limit_exceeded' });
  });

  it('handles concurrent ensureFolderTree calls targeting identical paths without errors or duplicates', async () => {
    const user = await createUser();

    const [first, second, third] = await Promise.all([
      entryService.ensureFolderTree(user, {
        parentId: null,
        paths: ['SharedTree/Level1/Level2', 'SharedTree/Sibling'],
      }),
      entryService.ensureFolderTree(user, {
        parentId: null,
        paths: ['sharedtree/level1/Level2', 'SharedTree/Sibling'],
      }),
      entryService.ensureFolderTree(user, {
        parentId: null,
        paths: ['SharedTree/Level1/Level2', 'SharedTree/Other'],
      }),
    ]);

    expect(first.folders['SharedTree']).toBe(second.folders['sharedtree']);
    expect(first.folders['SharedTree']).toBe(third.folders['SharedTree']);
    expect(first.folders['SharedTree/Level1/Level2']).toBe(
      second.folders['sharedtree/level1/Level2'],
    );
    expect(first.folders['SharedTree/Level1/Level2']).toBe(
      third.folders['SharedTree/Level1/Level2'],
    );
    expect(first.folders['SharedTree/Sibling']).toBe(second.folders['SharedTree/Sibling']);

    const activeFolders = await database
      .select()
      .from(entries)
      .where(and(eq(entries.ownerId, user.id), isNull(entries.deletedAt)));
    expect(activeFolders).toHaveLength(5);

    const events = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.ownerId, user.id));
    expect(events).toHaveLength(5);
  });

  it('serializes folders named __proto__ and constructor safely as own keys', async () => {
    const user = await createUser();

    const result = await entryService.ensureFolderTree(user, {
      parentId: null,
      paths: ['__proto__/constructor'],
    });

    expect(Object.hasOwn(result.folders, '__proto__')).toBe(true);
    expect(Object.hasOwn(result.folders, '__proto__/constructor')).toBe(true);

    const roundTripped = JSON.parse(JSON.stringify(result)) as { folders: Record<string, string> };
    expect(Object.entries(roundTripped.folders)).toHaveLength(2);
    expect(Object.hasOwn(roundTripped.folders, '__proto__')).toBe(true);
    expect(roundTripped.folders['__proto__/constructor']).toBe(
      result.folders['__proto__/constructor'],
    );
  });

  it('enforces max folder depth on createFolder, updateEntry moves, resolveFolderPath, and archive manifest CTEs', async () => {
    const user = await createUser();
    const depth62Chain = Array.from(
      { length: MAX_FOLDER_TREE_DEPTH - 2 },
      (_, i) => `d${i + 1}`,
    ).join('/');
    const created = await entryService.ensureFolderTree(user, {
      parentId: null,
      paths: [depth62Chain],
    });
    const depth62Id = created.folders[depth62Chain]!;
    const rootFolderId = created.folders['d1']!;

    // Depth 62 + 1 = 63 via createFolder -> allowed
    const depth63 = await entryService.createFolder(user, {
      parentId: depth62Id,
      name: 'd63',
    });

    // Depth 63 + 1 = 64 via createFolder -> allowed
    const depth64 = await entryService.createFolder(user, {
      parentId: depth63.id,
      name: 'd64',
    });

    // Depth 64 + 1 = 65 via createFolder -> rejected
    await expect(
      entryService.createFolder(user, {
        parentId: depth64.id,
        name: 'd65',
      }),
    ).rejects.toMatchObject({ code: 'folder_depth_limit_exceeded' });

    // Listing a depth-64 folder succeeds and returns the full 64-segment path
    const listingAt64 = await entryService.listEntries(user, {
      parentId: depth64.id,
      cursor: null,
      limit: 50,
      search: null,
      kind: null,
      sort: 'name-asc',
    });
    expect(listingAt64.path).toHaveLength(MAX_FOLDER_TREE_DEPTH);

    // Moving a 2-level subtree (height 2) under depth 63 (total 65) -> rejected
    const movableTree = await entryService.ensureFolderTree(user, {
      parentId: null,
      paths: ['MoveRoot/MoveChild'],
    });
    const moveRootId = movableTree.folders['MoveRoot']!;
    const moveChildId = movableTree.folders['MoveRoot/MoveChild']!;

    await expect(
      entryService.updateEntry(user, moveRootId, { parentId: depth63.id }),
    ).rejects.toMatchObject({ code: 'folder_depth_limit_exceeded' });

    // Moving a folder into its own descendant still returns move_would_create_cycle
    await expect(
      entryService.updateEntry(user, moveRootId, { parentId: moveChildId }),
    ).rejects.toMatchObject({ code: 'move_would_create_cycle' });

    // Moving a 2-level subtree under depth 62 (62 + 2 = 64) -> allowed
    await expect(
      entryService.updateEntry(user, moveRootId, { parentId: depth62Id }),
    ).resolves.toMatchObject({ id: moveRootId, kind: 'folder' });

    // Insert a file inside depth-64 folder AND a corrupt depth-65 folder directly via SQL
    const [depth64Row] = await database
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.publicId, depth64.id));
    const [rootRow] = await database
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.publicId, rootFolderId));

    const [fileAt64] = await database
      .insert(entries)
      .values({
        ownerId: user.id,
        parentId: depth64Row!.id,
        kind: 'file',
        name: 'leaf.txt',
      })
      .returning();
    await database.insert(files).values({
      entryId: fileAt64!.id,
      objectKey: `integration-tests/${randomUUID()}`,
      contentType: 'text/plain',
      sizeBytes: 42,
      sha256: 'a'.repeat(64),
    });

    const [corrupt65] = await database
      .insert(entries)
      .values({
        ownerId: user.id,
        parentId: depth64Row!.id,
        kind: 'folder',
        name: 'corrupt-d65',
      })
      .returning();

    // resolveFolderPath depth guard stops at 64 and rejects corrupt depth-65 folder cleanly
    await expect(
      entryService.listEntries(user, {
        parentId: corrupt65!.publicId,
        cursor: null,
        limit: 50,
        search: null,
        kind: null,
        sort: 'name-asc',
      }),
    ).rejects.toMatchObject({ code: 'folder_not_found' });

    // getArchiveManifest and getArchiveSummary include files inside depth-64 folders
    // while excluding corrupt depth-65 subfolders
    const manifest = await folderDownloadRepository.getArchiveManifest({
      ownerId: user.id,
      rootFolderId: rootRow!.id,
      rootFolderName: 'd1',
    });
    expect(
      manifest.some((item) => item.kind === 'file' && item.pathParts.at(-1) === 'leaf.txt'),
    ).toBe(true);
    expect(
      manifest.some((item) => item.kind === 'folder' && item.pathParts.at(-1) === 'corrupt-d65'),
    ).toBe(false);

    const summary = await unitOfWork.run((tx) =>
      folderDownloadRepository.getArchiveSummary(
        {
          ownerId: user.id,
          rootFolderId: rootRow!.id,
        },
        tx,
      ),
    );
    expect(summary).toStrictEqual({ fileCount: 1, totalSizeBytes: 42 });
  });

  it('serializes concurrent cross-branch folder moves and creates so cycles and depth-64 bypasses cannot occur', async () => {
    const user = await createUser();

    // Repeatedly race opposite-branch moves (A -> BLeaf and B -> ALeaf):
    // exactly one must succeed and the other must fail with move_would_create_cycle.
    for (let round = 0; round < 5; round += 1) {
      const treeA = await entryService.ensureFolderTree(user, {
        parentId: null,
        paths: [`CycleA${round}/Sub1/Sub2`],
      });
      const treeB = await entryService.ensureFolderTree(user, {
        parentId: null,
        paths: [`CycleB${round}/Sub1/Sub2`],
      });

      const results = await Promise.allSettled([
        entryService.updateEntry(user, treeA.folders[`CycleA${round}`]!, {
          parentId: treeB.folders[`CycleB${round}/Sub1/Sub2`]!,
        }),
        entryService.updateEntry(user, treeB.folders[`CycleB${round}`]!, {
          parentId: treeA.folders[`CycleA${round}/Sub1/Sub2`]!,
        }),
      ]);

      expect(results.map((result) => result.status).sort()).toStrictEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(rejected?.reason).toMatchObject({ code: 'move_would_create_cycle' });
    }

    // Race moving a 32-level subtree under a 32-level leaf while simultaneously creating
    // a 33rd child under the moved subtree's leaf (which together would produce depth 65).
    const chainA = Array.from({ length: 32 }, (_, i) => `BranchA_${i}`).join('/');
    const chainB = Array.from({ length: 32 }, (_, i) => `BranchB_${i}`).join('/');
    const treeA = await entryService.ensureFolderTree(user, { parentId: null, paths: [chainA] });
    const treeB = await entryService.ensureFolderTree(user, { parentId: null, paths: [chainB] });

    const depthRace = await Promise.allSettled([
      entryService.updateEntry(user, treeA.folders['BranchA_0']!, {
        parentId: treeB.folders[chainB]!,
      }),
      entryService.createFolder(user, {
        parentId: treeA.folders[chainA]!,
        name: 'OverflowChild',
      }),
    ]);

    expect(depthRace.map((result) => result.status).sort()).toStrictEqual([
      'fulfilled',
      'rejected',
    ]);
    const depthRejected = depthRace.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(depthRejected?.reason).toMatchObject({ code: 'folder_depth_limit_exceeded' });
  });

  async function createUser(): Promise<User> {
    const [created] = await database
      .insert(users)
      .values({
        issuer: OWNER_ISSUER,
        subject: `sub-${randomUUID()}`,
        email: `user-${randomUUID()}@example.com`,
        firstName: 'Test',
        lastName: 'User',
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create test user');
    }

    return created;
  }
});
