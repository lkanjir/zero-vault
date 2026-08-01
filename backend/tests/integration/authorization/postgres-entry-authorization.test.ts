import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entries, fileGrants, files, objectDeletionJobs, users } from '../../../src/db/schema.js';
import type { Database } from '../../../src/db/db-client.js';
import type { PostgresEntryRepository } from '../../../src/entry/postgres-entry-repository.js';

const ISSUER = 'https://issuer.example.test/realms/zero-vault';
const SHA256 = 'a'.repeat(64);

describe('PostgreSQL entry authorization', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let entryRepository: PostgresEntryRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('zero_vault_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    process.env['DATABASE_URL'] = container.getConnectionUri();

    const [
      databaseModule,
      entryRepositoryModule,
      contextResolverModule,
      policyModule,
      authorizationServiceModule,
      entryAuthorizerModule,
    ] = await Promise.all([
      import('../../../src/db/db-client.js'),
      import('../../../src/entry/postgres-entry-repository.js'),
      import('../../../src/authorization/postgres-authorization-context-resolver.js'),
      import('../../../src/authorization/authorization-policy.js'),
      import('../../../src/authorization/authorization-service.js'),
      import('../../../src/authorization/postgres-entry-authorizer.js'),
    ]);

    database = databaseModule.db;
    closeDatabase = databaseModule.closeDatabase;
    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });

    const authorizationService = new authorizationServiceModule.AuthorizationService(
      new contextResolverModule.PostgresAuthorizationContextResolver(),
      new policyModule.AuthorizationPolicy(),
    );
    const entryAuthorizer = new entryAuthorizerModule.PostgresEntryAuthorizer(authorizationService);
    entryRepository = new entryRepositoryModule.PostgresEntryRepository(entryAuthorizer);
  });

  beforeEach(async () => {
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

  it('allows an editor to rename a shared file', async () => {
    const owner = await createUser('owner');
    const editor = await createUser('editor');
    const file = await createFile(owner.id, 'original.txt');
    await createGrant(file.id, owner.id, editor.id, 'editor');

    await expect(
      entryRepository.updateEntry({
        actorUserId: editor.id,
        entryId: file.publicId,
        name: 'renamed.txt',
      }),
    ).resolves.toMatchObject({
      id: file.publicId,
      name: 'renamed.txt',
    });
  });

  it('rolls back an editor rename when the same request also attempts a move', async () => {
    const owner = await createUser('owner');
    const editor = await createUser('editor');
    const file = await createFile(owner.id, 'original.txt');
    const destination = await createFolder(owner.id, 'Destination');
    await createGrant(file.id, owner.id, editor.id, 'editor');

    await expect(
      entryRepository.updateEntry({
        actorUserId: editor.id,
        entryId: file.publicId,
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

  it('allows the owner to rename and move an entry atomically', async () => {
    const owner = await createUser('owner');
    const file = await createFile(owner.id, 'original.txt');
    const destination = await createFolder(owner.id, 'Destination');

    await expect(
      entryRepository.updateEntry({
        actorUserId: owner.id,
        entryId: file.publicId,
        name: 'renamed.txt',
        parentId: destination.publicId,
      }),
    ).resolves.toMatchObject({
      id: file.publicId,
      name: 'renamed.txt',
    });

    const [stored] = await database.select().from(entries).where(eq(entries.id, file.id));
    expect(stored).toMatchObject({
      name: 'renamed.txt',
      parentId: destination.id,
    });
    expect(stored?.updatedAt.getTime()).toBeGreaterThan(file.updatedAt.getTime());
  });

  it('does not delete or enqueue object deletion when an editor lacks delete access', async () => {
    const owner = await createUser('owner');
    const editor = await createUser('editor');
    const file = await createFile(owner.id, 'original.txt');
    await createGrant(file.id, owner.id, editor.id, 'editor');

    await expect(
      entryRepository.deleteEntry({
        actorUserId: editor.id,
        entryId: file.publicId,
      }),
    ).rejects.toMatchObject({
      code: 'authorization_denied',
    });

    const [stored] = await database.select().from(entries).where(eq(entries.id, file.id));
    expect(stored?.deletedAt).toBeNull();
    expect(await database.select().from(objectDeletionJobs)).toHaveLength(0);
  });

  async function createUser(username: string) {
    const [user] = await database
      .insert(users)
      .values({
        issuer: ISSUER,
        subject: randomUUID(),
        username,
      })
      .returning();

    if (!user) {
      throw new Error('Failed to create test user');
    }

    return user;
  }

  async function createFile(ownerId: number, name: string) {
    const [entry] = await database
      .insert(entries)
      .values({
        ownerId,
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
    recipientUserId: number,
    permission: 'viewer' | 'editor',
  ) {
    await database.insert(fileGrants).values({
      fileId,
      recipientUserId,
      createdByUserId: ownerId,
      permission,
    });
  }
});
