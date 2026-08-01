import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/db/db-client.js';
import { isUniqueViolation } from '../../../src/db/postgres-error.js';
import { entries, fileGrants, files, users } from '../../../src/db/schema.js';
import type { PostgresFileGrantRepository } from '../../../src/sharing/postgres-file-grant-repository.js';

const ISSUER = 'https://issuer.example.test/realms/zero-vault';
const SHA256 = 'a'.repeat(64);
const SUBMITTED_AT = new Date('2026-08-01T10:00:00.000Z');
const PENDING_DEADLINE = new Date('2026-08-02T10:00:00.000Z');

describe('PostgresFileGrantRepository', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let repository: PostgresFileGrantRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('zero_vault_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    process.env['DATABASE_URL'] = container.getConnectionUri();

    const [
      databaseModule,
      contextResolverModule,
      policyModule,
      authorizationServiceModule,
      entryAuthorizerModule,
      repositoryModule,
    ] = await Promise.all([
      import('../../../src/db/db-client.js'),
      import('../../../src/authorization/postgres-authorization-context-resolver.js'),
      import('../../../src/authorization/authorization-policy.js'),
      import('../../../src/authorization/authorization-service.js'),
      import('../../../src/authorization/postgres-entry-authorizer.js'),
      import('../../../src/sharing/postgres-file-grant-repository.js'),
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
    repository = new repositoryModule.PostgresFileGrantRepository(entryAuthorizer);
  });

  beforeEach(async () => {
    await database.delete(fileGrants);
    await database.delete(files);
    await database.delete(entries);
    await database.delete(users);
  });

  afterAll(async () => {
    await closeDatabase();
    await container.stop();
  });

  it('creates an active grant for an existing application user', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);
    const expiresAt = new Date('2026-08-05T10:00:00.000Z');

    const grant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    expect(grant).toMatchObject({
      fileId: file.id,
      recipientEmail: recipient.email,
      recipientUserId: recipient.id,
      createdByUserId: owner.id,
      permission: 'viewer',
      activationDeadline: null,
      expiresAt,
      createdAt: SUBMITTED_AT,
      updatedAt: SUBMITTED_AT,
    });
  });

  it('creates a pending grant when the recipient does not exist', async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);

    const grant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: 'pending@example.com',
      permission: 'editor',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    expect(grant).toMatchObject({
      fileId: file.id,
      recipientEmail: 'pending@example.com',
      recipientUserId: null,
      permission: 'editor',
      activationDeadline: PENDING_DEADLINE,
      expiresAt: null,
    });
  });

  it('activates an existing pending grant when the recipient becomes available', async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);
    const recipientEmail = 'later@example.com';

    const pending = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail,
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });
    const recipient = await createUser(recipientEmail);
    const updatedAt = new Date('2026-08-01T11:00:00.000Z');
    const expiresAt = new Date('2026-08-05T10:00:00.000Z');

    const active = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail,
      permission: 'editor',
      expiresAt,
      submittedAt: updatedAt,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    expect(active).toMatchObject({
      id: pending.id,
      publicId: pending.publicId,
      recipientUserId: recipient.id,
      recipientEmail,
      permission: 'editor',
      activationDeadline: null,
      expiresAt,
      createdAt: SUBMITTED_AT,
      updatedAt,
    });
  });

  it('updates an active grant without replacing its identity or creation time', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);
    const existing = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });
    const updatedAt = new Date('2026-08-01T12:00:00.000Z');
    const expiresAt = new Date('2026-08-10T10:00:00.000Z');

    const updated = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'editor',
      expiresAt,
      submittedAt: updatedAt,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    expect(updated).toMatchObject({
      id: existing.id,
      publicId: existing.publicId,
      permission: 'editor',
      expiresAt,
      createdAt: SUBMITTED_AT,
      updatedAt,
    });
  });

  it('does not create a grant when the actor cannot manage sharing', async () => {
    const owner = await createUser('owner@example.com');
    const otherUser = await createUser('other@example.com');
    const file = await createFile(owner.id);

    await expect(
      repository.save({
        actorUserId: otherUser.id,
        filePublicId: file.publicId,
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
        expiresAt: null,
        submittedAt: SUBMITTED_AT,
        pendingActivationDeadline: PENDING_DEADLINE,
      }),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
    });

    await expect(database.select().from(fileGrants)).resolves.toHaveLength(0);
  });

  it('enforces one active grant per recipient and file at the database boundary', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);

    await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    let caught: unknown;
    try {
      await database.insert(fileGrants).values({
        fileId: file.id,
        recipientUserId: recipient.id,
        recipientEmail: 'alias@example.com',
        createdByUserId: owner.id,
        permission: 'editor',
        createdAt: SUBMITTED_AT,
        updatedAt: SUBMITTED_AT,
      });
    } catch (error) {
      caught = error;
    }

    expect(isUniqueViolation(caught, 'file_grants_file_recipient_user_key')).toBe(true);
  });

  it('keeps one grant when an active recipient changes their verified email', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('old@example.com');
    const file = await createFile(owner.id);
    const existing = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });
    const newEmail = 'new@example.com';
    await database.update(users).set({ email: newEmail }).where(eq(users.id, recipient.id));

    const updated = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: newEmail,
      permission: 'editor',
      expiresAt: null,
      submittedAt: new Date('2026-08-01T11:00:00.000Z'),
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    expect(updated).toMatchObject({
      id: existing.id,
      publicId: existing.publicId,
      recipientUserId: recipient.id,
      recipientEmail: newEmail,
      permission: 'editor',
    });
    await expect(database.select().from(fileGrants)).resolves.toHaveLength(1);
  });

  async function createUser(email: string) {
    const [user] = await database
      .insert(users)
      .values({
        issuer: ISSUER,
        subject: randomUUID(),
        email,
        username: email,
      })
      .returning();

    if (!user) {
      throw new Error('Failed to create integration test user');
    }

    return user;
  }

  async function createFile(ownerId: number) {
    const [entry] = await database
      .insert(entries)
      .values({
        ownerId,
        kind: 'file',
        name: 'document.txt',
      })
      .returning();

    if (!entry) {
      throw new Error('Failed to create integration test file entry');
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
});
