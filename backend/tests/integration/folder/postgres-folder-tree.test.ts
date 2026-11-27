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
import { MAX_FOLDER_TREE_DEPTH } from '../../../src/folder/validation-schemas.js';
import type { User } from '../../../src/user/user.js';

const OWNER_ISSUER = 'https://issuer.example.test/realms/zero-vault';

describe('PostgresEntryRepository and EntryService.ensureFolderTree', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let entryService: EntryService;

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
    const unitOfWork = new DrizzleUnitOfWork(database);
    const entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    const entryRepository = new PostgresEntryRepository(database);
    const auditRepository = new PostgresAuditRepository(database);
    const accessMapper = new EntryAccessMapper(authorizationPolicy);

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
