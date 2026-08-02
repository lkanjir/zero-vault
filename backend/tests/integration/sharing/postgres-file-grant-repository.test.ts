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

  it("lists one file's grants in stable pages without duplicates", async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);
    const otherFile = await createFile(owner.id, 'other.txt');

    for (const recipientEmail of [
      'charlie@example.com',
      'alpha@example.com',
      'bravo@example.com',
    ]) {
      await repository.save({
        actorUserId: owner.id,
        filePublicId: file.publicId,
        recipientEmail,
        permission: 'viewer',
        expiresAt: null,
        submittedAt: SUBMITTED_AT,
        pendingActivationDeadline: PENDING_DEADLINE,
      });
    }

    await repository.save({
      actorUserId: owner.id,
      filePublicId: otherFile.publicId,
      recipientEmail: 'other@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    const firstPage = await repository.listByFileId({
      fileId: file.id,
      cursor: null,
      limit: 2,
    });

    expect(firstPage.map((grant) => grant.recipientEmail)).toEqual([
      'alpha@example.com',
      'bravo@example.com',
    ]);

    const lastGrant = firstPage.at(-1);
    if (!lastGrant) {
      throw new Error('Expected the first grant page to contain a cursor source');
    }

    const secondPage = await repository.listByFileId({
      fileId: file.id,
      cursor: {
        recipientEmail: lastGrant.recipientEmail,
        grantDbId: lastGrant.id,
      },
      limit: 2,
    });

    expect(secondPage.map((grant) => grant.recipientEmail)).toEqual(['charlie@example.com']);
    expect(secondPage.some((grant) => firstPage.some((first) => first.id === grant.id))).toBe(
      false,
    );
  });

  it('revokes both active and pending grants', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);
    const activeGrant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });
    const pendingGrant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: 'pending@example.com',
      permission: 'editor',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    await repository.revoke({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      grantPublicId: activeGrant.publicId,
    });
    await repository.revoke({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      grantPublicId: pendingGrant.publicId,
    });

    await expect(database.select().from(fileGrants)).resolves.toHaveLength(0);
  });

  it('does not revoke a grant belonging to another file and treats missing grants as success', async () => {
    const owner = await createUser('owner@example.com');
    const targetFile = await createFile(owner.id);
    const otherFile = await createFile(owner.id, 'other.txt');
    const otherGrant = await repository.save({
      actorUserId: owner.id,
      filePublicId: otherFile.publicId,
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    await repository.revoke({
      actorUserId: owner.id,
      filePublicId: targetFile.publicId,
      grantPublicId: otherGrant.publicId,
    });
    await repository.revoke({
      actorUserId: owner.id,
      filePublicId: targetFile.publicId,
      grantPublicId: randomUUID(),
    });

    const remainingGrants = await database.select().from(fileGrants);
    expect(remainingGrants).toHaveLength(1);
    expect(remainingGrants[0]?.publicId).toBe(otherGrant.publicId);
  });

  it('does not revoke a grant when the actor cannot manage the file sharing', async () => {
    const owner = await createUser('owner@example.com');
    const otherUser = await createUser('other@example.com');
    const file = await createFile(owner.id);
    const grant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    await expect(
      repository.revoke({
        actorUserId: otherUser.id,
        filePublicId: file.publicId,
        grantPublicId: grant.publicId,
      }),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
    });

    const remainingGrants = await database.select().from(fileGrants);
    expect(remainingGrants).toHaveLength(1);
    expect(remainingGrants[0]?.publicId).toBe(grant.publicId);
  });

  it('partially updates an active grant while preserving its identity and omitted fields', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);
    const originalExpiry = new Date('2026-08-05T10:00:00.000Z');
    const grant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: originalExpiry,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });
    const permissionUpdatedAt = new Date('2026-08-01T11:00:00.000Z');

    const permissionUpdated = await repository.update({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      grantPublicId: grant.publicId,
      permission: 'editor',
      expiresAt: undefined,
      updatedAt: permissionUpdatedAt,
    });

    expect(permissionUpdated).toMatchObject({
      id: grant.id,
      publicId: grant.publicId,
      permission: 'editor',
      expiresAt: originalExpiry,
      activationDeadline: null,
      updatedAt: permissionUpdatedAt,
    });

    const expiryClearedAt = new Date('2026-08-01T12:00:00.000Z');
    const expiryCleared = await repository.update({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      grantPublicId: grant.publicId,
      permission: undefined,
      expiresAt: null,
      updatedAt: expiryClearedAt,
    });

    expect(expiryCleared).toMatchObject({
      id: grant.id,
      permission: 'editor',
      expiresAt: null,
      activationDeadline: null,
      updatedAt: expiryClearedAt,
    });
  });

  it('only shortens a pending grant activation deadline', async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);
    const grant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: 'pending@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });
    const earlierExpiry = new Date('2026-08-01T12:00:00.000Z');

    const shortened = await repository.update({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      grantPublicId: grant.publicId,
      permission: undefined,
      expiresAt: earlierExpiry,
      updatedAt: new Date('2026-08-01T11:00:00.000Z'),
    });

    expect(shortened).toMatchObject({
      expiresAt: earlierExpiry,
      activationDeadline: earlierExpiry,
    });

    const laterExpiry = new Date('2026-08-05T10:00:00.000Z');
    const extended = await repository.update({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      grantPublicId: grant.publicId,
      permission: undefined,
      expiresAt: laterExpiry,
      updatedAt: new Date('2026-08-01T11:30:00.000Z'),
    });

    expect(extended).toMatchObject({
      expiresAt: laterExpiry,
      activationDeadline: earlierExpiry,
    });

    const expiryCleared = await repository.update({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      grantPublicId: grant.publicId,
      permission: undefined,
      expiresAt: null,
      updatedAt: new Date('2026-08-01T11:45:00.000Z'),
    });

    expect(expiryCleared).toMatchObject({
      expiresAt: null,
      activationDeadline: earlierExpiry,
    });
  });

  it('returns null without changing a grant belonging to another file', async () => {
    const owner = await createUser('owner@example.com');
    const targetFile = await createFile(owner.id);
    const otherFile = await createFile(owner.id, 'other.txt');
    const otherGrant = await repository.save({
      actorUserId: owner.id,
      filePublicId: otherFile.publicId,
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    const result = await repository.update({
      actorUserId: owner.id,
      filePublicId: targetFile.publicId,
      grantPublicId: otherGrant.publicId,
      permission: 'editor',
      expiresAt: undefined,
      updatedAt: new Date('2026-08-01T11:00:00.000Z'),
    });

    expect(result).toBeNull();
    const [storedGrant] = await database.select().from(fileGrants);
    expect(storedGrant).toMatchObject({
      publicId: otherGrant.publicId,
      permission: 'viewer',
      updatedAt: SUBMITTED_AT,
    });
  });

  it('does not update a grant when a recipient cannot manage sharing', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);
    const grant = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: PENDING_DEADLINE,
    });

    await expect(
      repository.update({
        actorUserId: recipient.id,
        filePublicId: file.publicId,
        grantPublicId: grant.publicId,
        permission: 'editor',
        expiresAt: undefined,
        updatedAt: new Date('2026-08-01T11:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'authorization_denied',
    });

    const [storedGrant] = await database.select().from(fileGrants);
    expect(storedGrant).toMatchObject({
      publicId: grant.publicId,
      permission: 'viewer',
      updatedAt: SUBMITTED_AT,
    });
  });

  it('deletes expired pending grants and activates recipients available before the deadline', async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);
    const processedAt = PENDING_DEADLINE;
    const futureDeadline = new Date('2026-08-03T10:00:00.000Z');

    const expired = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: 'expired@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: processedAt,
    });
    const activatable = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: 'available@example.com',
      permission: 'editor',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: futureDeadline,
    });
    const unresolved = await repository.save({
      actorUserId: owner.id,
      filePublicId: file.publicId,
      recipientEmail: 'unresolved@example.com',
      permission: 'viewer',
      expiresAt: null,
      submittedAt: SUBMITTED_AT,
      pendingActivationDeadline: futureDeadline,
    });
    const recipient = await createUser('available@example.com');

    await expect(repository.maintainPending({ processedAt, limit: 100 })).resolves.toStrictEqual({
      activatedCount: 1,
      deletedCount: 1,
    });

    const storedGrants = await database.select().from(fileGrants);
    expect(storedGrants.some((grant) => grant.id === expired.id)).toBe(false);
    expect(storedGrants.find((grant) => grant.id === activatable.id)).toMatchObject({
      recipientUserId: recipient.id,
      activationDeadline: null,
      permission: 'editor',
      updatedAt: processedAt,
    });
    expect(storedGrants.find((grant) => grant.id === unresolved.id)).toMatchObject({
      recipientUserId: null,
      activationDeadline: futureDeadline,
    });
  });

  it('applies the maintenance limit independently to deletion and activation', async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);
    const processedAt = PENDING_DEADLINE;

    for (const [recipientEmail, pendingActivationDeadline] of [
      ['expired-first@example.com', new Date('2026-08-02T08:00:00.000Z')],
      ['expired-second@example.com', new Date('2026-08-02T09:00:00.000Z')],
    ] as const) {
      await repository.save({
        actorUserId: owner.id,
        filePublicId: file.publicId,
        recipientEmail,
        permission: 'viewer',
        expiresAt: null,
        submittedAt: SUBMITTED_AT,
        pendingActivationDeadline,
      });
    }

    for (const recipientEmail of ['available-first@example.com', 'available-second@example.com']) {
      await repository.save({
        actorUserId: owner.id,
        filePublicId: file.publicId,
        recipientEmail,
        permission: 'viewer',
        expiresAt: null,
        submittedAt: SUBMITTED_AT,
        pendingActivationDeadline: new Date('2026-08-03T10:00:00.000Z'),
      });
      await createUser(recipientEmail);
    }

    await expect(repository.maintainPending({ processedAt, limit: 1 })).resolves.toStrictEqual({
      activatedCount: 1,
      deletedCount: 1,
    });
    await expect(repository.maintainPending({ processedAt, limit: 1 })).resolves.toStrictEqual({
      activatedCount: 1,
      deletedCount: 1,
    });

    const storedGrants = await database.select().from(fileGrants);
    expect(storedGrants).toHaveLength(2);
    expect(storedGrants.every((grant) => grant.recipientUserId !== null)).toBe(true);
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

  async function createFile(ownerId: number, name = 'document.txt') {
    const [entry] = await database
      .insert(entries)
      .values({
        ownerId,
        kind: 'file',
        name,
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
