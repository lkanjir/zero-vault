import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditRepository } from '../../../src/audit/audit-repository.js';
import { PostgresAuditRepository } from '../../../src/audit/postgres-audit-repository.js';
import {
  auditEvents,
  entries,
  fileGrants,
  files,
  objectDeletionJobs,
  users,
} from '../../../src/db/schema.js';
import { AuthorizationPolicy } from '../../../src/authorization/authorization-policy.js';
import { AuthorizationService } from '../../../src/authorization/authorization-service.js';
import { EntryAccessMapper } from '../../../src/authorization/entry-access-mapper.js';
import { PostgresAuthorizationContextResolver } from '../../../src/authorization/postgres-authorization-context-resolver.js';
import { PostgresEntryAuthorizer } from '../../../src/authorization/postgres-entry-authorizer.js';
import { createDatabase, type Database } from '../../../src/db/db-client.js';
import { DrizzleUnitOfWork } from '../../../src/db/unit-of-work.js';
import { EntryService } from '../../../src/entry/entry-service.js';
import { PostgresEntryRepository } from '../../../src/entry/postgres-entry-repository.js';

const ISSUER = 'https://issuer.example.test/realms/zero-vault';
const SHA256 = 'a'.repeat(64);

describe('PostgreSQL entry authorization and transactions', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let unitOfWork: DrizzleUnitOfWork;
  let entryAuthorizer: PostgresEntryAuthorizer;
  let entryRepository: PostgresEntryRepository;
  let auditRepository: PostgresAuditRepository;
  let accessMapper: EntryAccessMapper;
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
    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });

    const policy = new AuthorizationPolicy();
    const authorizationService = new AuthorizationService(
      new PostgresAuthorizationContextResolver(database),
      policy,
    );
    unitOfWork = new DrizzleUnitOfWork(database);
    entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    entryRepository = new PostgresEntryRepository(database);
    auditRepository = new PostgresAuditRepository(database);
    accessMapper = new EntryAccessMapper(policy);
    entryService = new EntryService(
      unitOfWork,
      entryAuthorizer,
      entryRepository,
      auditRepository,
      accessMapper,
    );
  });

  beforeEach(async () => {
    await database.delete(auditEvents);
    await database.delete(objectDeletionJobs);
    await database.delete(fileGrants);
    await database.delete(files);
    await database.delete(entries);
    await database.delete(users);
  });

  afterAll(async () => {
    await closeDatabase();
    await container.stop();
  });

  it('allows an editor to rename a shared file and returns editor access capabilities', async () => {
    const owner = await createUser('owner');
    const editor = await createUser('editor');
    const file = await createFile(owner.id, 'original.txt');
    await createGrant(file.id, owner.id, editor, 'editor');

    await expect(
      entryService.updateEntry(editor, file.publicId, {
        name: 'renamed.txt',
      }),
    ).resolves.toMatchObject({
      id: file.publicId,
      name: 'renamed.txt',
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
  });

  it('rolls back an editor rename when the same request also attempts a move', async () => {
    const owner = await createUser('owner');
    const editor = await createUser('editor');
    const file = await createFile(owner.id, 'original.txt');
    const destination = await createFolder(owner.id, 'Destination');
    await createGrant(file.id, owner.id, editor, 'editor');

    await expect(
      entryService.updateEntry(editor, file.publicId, {
        name: 'renamed.txt',
        parentId: destination.publicId,
      }),
    ).rejects.toMatchObject({
      code: 'authorization_denied',
    });

    const [stored] = await database.select().from(entries).where(eq(entries.id, file.id));
    expect(stored).toMatchObject({
      name: 'original.txt',
      parentId: null,
    });
  });

  it('allows the owner to rename and move an entry atomically with owner access capabilities', async () => {
    const owner = await createUser('owner');
    const file = await createFile(owner.id, 'original.txt');
    const destination = await createFolder(owner.id, 'Destination');

    await expect(
      entryService.updateEntry(owner, file.publicId, {
        name: 'renamed.txt',
        parentId: destination.publicId,
      }),
    ).resolves.toMatchObject({
      id: file.publicId,
      name: 'renamed.txt',
      access: {
        accessLevel: 'owner',
        capabilities: {
          download: true,
          rename: true,
          replaceContent: true,
          move: true,
          delete: true,
          manageSharing: true,
        },
      },
    });

    const [stored] = await database.select().from(entries).where(eq(entries.id, file.id));
    expect(stored).toMatchObject({
      name: 'renamed.txt',
      parentId: destination.id,
    });
    expect(stored?.updatedAt.getTime()).toBeGreaterThan(file.updatedAt.getTime());

    const recordedEvents = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entryId, file.id));
    expect(recordedEvents.map((event) => event.action).sort()).toStrictEqual([
      'entry.moved',
      'entry.renamed',
    ]);
  });

  it('rolls back an entry rename when audit recording fails', async () => {
    const owner = await createUser('owner');
    const file = await createFile(owner.id, 'original.txt');
    const failingAuditRepo: AuditRepository = {
      record: () => Promise.reject(new Error('audit write failed')),
      listEvents: () => Promise.resolve([]),
      getStatistics: () =>
        Promise.resolve({ total: 0, entryChanges: 0, downloadRequests: 0, sharingChanges: 0 }),
    };
    const serviceWithFailingAudit = new EntryService(
      unitOfWork,
      entryAuthorizer,
      entryRepository,
      failingAuditRepo,
      accessMapper,
    );

    await expect(
      serviceWithFailingAudit.updateEntry(owner, file.publicId, { name: 'renamed.txt' }),
    ).rejects.toThrow('audit write failed');

    const [stored] = await database.select().from(entries).where(eq(entries.id, file.id));
    expect(stored).toMatchObject({
      name: 'original.txt',
      updatedAt: file.updatedAt,
    });
  });

  it('maps a duplicate destination name and rolls back the move', async () => {
    const owner = await createUser('owner');
    const source = await createFolder(owner.id, 'Source');
    const destination = await createFolder(owner.id, 'Destination');
    const movedFile = await createFile(owner.id, 'duplicate.txt', source.id);
    await createFile(owner.id, 'duplicate.txt', destination.id);

    await expect(
      entryService.updateEntry(owner, movedFile.publicId, {
        parentId: destination.publicId,
      }),
    ).rejects.toMatchObject({
      code: 'duplicate_entry_name',
    });

    const [stored] = await database.select().from(entries).where(eq(entries.id, movedFile.id));
    expect(stored).toMatchObject({
      parentId: source.id,
      updatedAt: movedFile.updatedAt,
    });

    const recordedEvents = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entryId, movedFile.id));
    expect(recordedEvents).toHaveLength(0);
  });

  it('authorizes the owner drive root when moving an entry out of a folder', async () => {
    const owner = await createUser('owner');
    const sourceFolder = await createFolder(owner.id, 'Source');
    const file = await createFile(owner.id, 'nested.txt', sourceFolder.id);

    await entryService.updateEntry(owner, file.publicId, {
      parentId: null,
    });

    const [stored] = await database.select().from(entries).where(eq(entries.id, file.id));
    expect(stored?.parentId).toBeNull();
  });

  it('does not delete or enqueue object deletion when an editor lacks delete access', async () => {
    const owner = await createUser('owner');
    const editor = await createUser('editor');
    const file = await createFile(owner.id, 'original.txt');
    await createGrant(file.id, owner.id, editor, 'editor');

    await expect(entryService.deleteEntry(editor, file.publicId)).rejects.toMatchObject({
      code: 'authorization_denied',
    });

    const [stored] = await database.select().from(entries).where(eq(entries.id, file.id));
    expect(stored?.deletedAt).toBeNull();
    expect(await database.select().from(objectDeletionJobs)).toHaveLength(0);
  });

  it('authorizes creating folders in the actor drive root and a nested parent', async () => {
    const owner = await createUser('owner');

    const rootFolder = await entryService.createFolder(owner, {
      parentId: null,
      name: 'Root folder',
    });
    const nestedFolder = await entryService.createFolder(owner, {
      parentId: rootFolder.id,
      name: 'Nested folder',
    });

    const [storedRoot] = await database
      .select()
      .from(entries)
      .where(eq(entries.publicId, rootFolder.id));
    const [storedNested] = await database
      .select()
      .from(entries)
      .where(eq(entries.publicId, nestedFolder.id));

    expect(storedRoot).toMatchObject({
      ownerId: owner.id,
      parentId: null,
    });
    expect(storedNested).toMatchObject({
      ownerId: owner.id,
      parentId: storedRoot?.id,
    });
  });

  it('does not create a folder under another users parent', async () => {
    const owner = await createUser('owner');
    const otherUser = await createUser('other-user');
    const parent = await createFolder(owner.id, 'Private parent');

    await expect(
      entryService.createFolder(otherUser, {
        parentId: parent.publicId,
        name: 'Unauthorized child',
      }),
    ).rejects.toMatchObject({
      code: 'folder_not_found',
    });

    const stored = await database
      .select()
      .from(entries)
      .where(eq(entries.name, 'Unauthorized child'));
    expect(stored).toHaveLength(0);
  });

  async function createUser(userLabel: string) {
    const [user] = await database
      .insert(users)
      .values({
        issuer: ISSUER,
        subject: randomUUID(),
        email: `${userLabel}-${randomUUID()}@example.com`,
        firstName: 'Test',
        lastName: 'User',
      })
      .returning();

    if (!user) {
      throw new Error('Failed to create test user');
    }

    return user;
  }

  async function createFile(ownerId: number, name: string, parentId: number | null = null) {
    const [entry] = await database
      .insert(entries)
      .values({
        ownerId,
        parentId,
        kind: 'file',
        name,
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      })
      .returning();

    if (!entry) {
      throw new Error('Failed to create test file entry');
    }

    await database.insert(files).values({
      entryId: entry.id,
      objectKey: `test/${randomUUID()}`,
      contentType: 'text/plain',
      sizeBytes: 1,
      sha256: SHA256,
    });

    return entry;
  }

  async function createFolder(ownerId: number, name: string) {
    const [folder] = await database
      .insert(entries)
      .values({
        ownerId,
        kind: 'folder',
        name,
      })
      .returning();

    if (!folder) {
      throw new Error('Failed to create test folder');
    }

    return folder;
  }

  async function createGrant(
    fileId: number,
    ownerId: number,
    recipient: { id: number; email: string },
    permission: 'viewer' | 'editor',
  ) {
    await database.insert(fileGrants).values({
      fileId,
      recipientUserId: recipient.id,
      recipientEmail: recipient.email,
      createdByUserId: ownerId,
      permission,
    });
  }
});
