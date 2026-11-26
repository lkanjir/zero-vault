import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditRepository } from '../../../src/audit/audit-repository.js';
import { PostgresAuditRepository } from '../../../src/audit/postgres-audit-repository.js';
import { AuthorizationPolicy } from '../../../src/authorization/authorization-policy.js';
import { AuthorizationService } from '../../../src/authorization/authorization-service.js';
import { EntryAccessMapper } from '../../../src/authorization/entry-access-mapper.js';
import { PostgresAuthorizationContextResolver } from '../../../src/authorization/postgres-authorization-context-resolver.js';
import { PostgresEntryAuthorizer } from '../../../src/authorization/postgres-entry-authorizer.js';
import { createDatabase, type Database } from '../../../src/db/db-client.js';
import { isUniqueViolation } from '../../../src/db/postgres-error.js';
import { DrizzleUnitOfWork } from '../../../src/db/unit-of-work.js';
import { auditEvents, entries, fileGrants, files, users } from '../../../src/db/schema.js';
import { FileSharingService } from '../../../src/sharing/file-sharing-service.js';
import { PostgresFileGrantRepository } from '../../../src/sharing/postgres-file-grant-repository.js';

const ISSUER = 'https://issuer.example.test/realms/zero-vault';
const SHA256 = 'a'.repeat(64);
const SUBMITTED_AT = new Date('2026-08-01T10:00:00.000Z');
const PENDING_DEADLINE = new Date('2026-08-02T10:00:00.000Z');

describe('PostgresFileGrantRepository and FileSharingService', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let unitOfWork: DrizzleUnitOfWork;
  let authorizationService: AuthorizationService;
  let entryAuthorizer: PostgresEntryAuthorizer;
  let accessMapper: EntryAccessMapper;
  let auditRepository: PostgresAuditRepository;
  let repository: PostgresFileGrantRepository;
  let sharingService: FileSharingService;

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
    unitOfWork = new DrizzleUnitOfWork(database);
    authorizationService = new AuthorizationService(
      new PostgresAuthorizationContextResolver(database),
      policy,
    );
    entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    accessMapper = new EntryAccessMapper(policy);
    auditRepository = new PostgresAuditRepository(database);
    repository = new PostgresFileGrantRepository(database);
    sharingService = new FileSharingService(
      unitOfWork,
      authorizationService,
      entryAuthorizer,
      repository,
      auditRepository,
      accessMapper,
    );
  });

  beforeEach(async () => {
    await database.delete(auditEvents);
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

    const grant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt,
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

    const grant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: 'pending@example.com',
      permission: 'editor',
      expiresAt: null,
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

    const pending = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail,
      permission: 'viewer',
      expiresAt: null,
    });
    const recipient = await createUser(recipientEmail);
    const updatedAt = new Date('2026-08-01T11:00:00.000Z');
    const expiresAt = new Date('2026-08-05T10:00:00.000Z');

    const active = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail,
      permission: 'editor',
      expiresAt,
      submittedAt: updatedAt,
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
    const existing = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
    });
    const updatedAt = new Date('2026-08-01T12:00:00.000Z');
    const expiresAt = new Date('2026-08-10T10:00:00.000Z');

    const updated = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'editor',
      expiresAt,
      submittedAt: updatedAt,
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

  it('does not create a grant or audit event when the actor cannot manage sharing', async () => {
    const owner = await createUser('owner@example.com');
    const otherUser = await createUser('other@example.com');
    const file = await createFile(owner.id);

    await expect(
      sharingService.shareFile(otherUser, file.publicId, {
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
        expiresAt: null,
      }),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
    });

    await expect(database.select().from(fileGrants)).resolves.toHaveLength(0);
    await expect(database.select().from(auditEvents)).resolves.toHaveLength(0);
  });

  it('rolls back grant persistence when share audit recording fails', async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);
    const failingAuditRepository: AuditRepository = {
      record: () => Promise.reject(new Error('audit write failed')),
      listEvents: () => Promise.resolve([]),
      getStatistics: () =>
        Promise.resolve({ total: 0, entryChanges: 0, downloadRequests: 0, sharingChanges: 0 }),
    };
    const serviceWithFailingAudit = new FileSharingService(
      unitOfWork,
      authorizationService,
      entryAuthorizer,
      repository,
      failingAuditRepository,
      accessMapper,
    );

    await expect(
      serviceWithFailingAudit.shareFile(owner, file.publicId, {
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
        expiresAt: null,
      }),
    ).rejects.toThrow('audit write failed');

    await expect(database.select().from(fileGrants)).resolves.toHaveLength(0);
    await expect(database.select().from(auditEvents)).resolves.toHaveLength(0);
  });

  it('enforces one active grant per recipient and file at the database boundary', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);

    await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
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
    const existing = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
    });
    const newEmail = 'new@example.com';
    await database.update(users).set({ email: newEmail }).where(eq(users.id, recipient.id));

    const updated = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: newEmail,
      permission: 'editor',
      expiresAt: null,
      submittedAt: new Date('2026-08-01T11:00:00.000Z'),
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
      await saveGrant({
        fileId: file.id,
        createdByUserId: owner.id,
        recipientEmail,
        permission: 'viewer',
        expiresAt: null,
      });
    }

    await saveGrant({
      fileId: otherFile.id,
      createdByUserId: owner.id,
      recipientEmail: 'other@example.com',
      permission: 'viewer',
      expiresAt: null,
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

  it('lists only active non-deleted files shared with the recipient', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const otherRecipient = await createUser('other@example.com');
    const visibleFile = await createFile(owner.id, 'Visible.txt');
    const expiredFile = await createFile(owner.id, 'Expired.txt');
    const deletedFile = await createFile(owner.id, 'Deleted.txt');
    const otherFile = await createFile(owner.id, 'Other.txt');
    const listedAt = new Date('2026-08-02T10:00:00.000Z');

    await saveGrant({
      fileId: visibleFile.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'editor',
      expiresAt: null,
    });
    await saveGrant({
      fileId: expiredFile.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: listedAt,
    });
    await saveGrant({
      fileId: deletedFile.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
    });
    await saveGrant({
      fileId: otherFile.id,
      createdByUserId: owner.id,
      recipientEmail: otherRecipient.email,
      permission: 'viewer',
      expiresAt: null,
    });
    await database
      .update(entries)
      .set({ deletedAt: listedAt })
      .where(eq(entries.id, deletedFile.id));

    const result = await repository.listSharedFiles({
      recipientUserId: recipient.id,
      listedAt,
      cursor: null,
      limit: 10,
    });

    expect(result).toStrictEqual([
      {
        file: {
          id: visibleFile.publicId,
          name: 'Visible.txt',
          contentType: 'text/plain',
          sizeBytes: 1,
          updatedAt: visibleFile.updatedAt,
        },
        owner: {
          id: owner.id,
          email: owner.email,
          firstName: owner.firstName,
          lastName: owner.lastName,
        },
        grant: {
          permission: 'editor',
          expiresAt: null,
        },
        cursor: {
          sortName: 'visible.txt',
          entryId: visibleFile.id,
        },
      },
    ]);
  });

  it('lists shared files in stable cursor pages without duplicates', async () => {
    const firstOwner = await createUser('first-owner@example.com');
    const secondOwner = await createUser('second-owner@example.com');
    const recipient = await createUser('recipient@example.com');

    for (const [owner, name] of [
      [firstOwner, 'bravo.txt'],
      [firstOwner, 'Alpha.txt'],
      [secondOwner, 'alpha.txt'],
    ] as const) {
      const file = await createFile(owner.id, name);
      await saveGrant({
        fileId: file.id,
        createdByUserId: owner.id,
        recipientEmail: recipient.email,
        permission: 'viewer',
        expiresAt: null,
      });
    }

    const firstPage = await repository.listSharedFiles({
      recipientUserId: recipient.id,
      listedAt: PENDING_DEADLINE,
      cursor: null,
      limit: 2,
    });
    const lastRecord = firstPage.at(-1);
    if (!lastRecord) {
      throw new Error('Expected the first shared-file page to contain a cursor source');
    }

    const secondPage = await repository.listSharedFiles({
      recipientUserId: recipient.id,
      listedAt: PENDING_DEADLINE,
      cursor: lastRecord.cursor,
      limit: 2,
    });

    expect(firstPage.map((record) => record.cursor.sortName)).toEqual(['alpha.txt', 'alpha.txt']);
    expect(secondPage.map((record) => record.file.name)).toEqual(['bravo.txt']);
    expect(
      secondPage.some((record) =>
        firstPage.some((firstRecord) => firstRecord.file.id === record.file.id),
      ),
    ).toBe(false);
  });

  it('revokes both active and pending grants and records audit events', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);
    const activeGrant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
    });
    const pendingGrant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: 'pending@example.com',
      permission: 'editor',
      expiresAt: null,
    });

    await sharingService.revokeFileShare(owner, file.publicId, activeGrant.publicId);
    await sharingService.revokeFileShare(owner, file.publicId, pendingGrant.publicId);

    await expect(database.select().from(fileGrants)).resolves.toHaveLength(0);
    const events = await database.select().from(auditEvents);
    expect(events.map((event) => event.action)).toStrictEqual([
      'file.share_revoked',
      'file.share_revoked',
    ]);
  });

  it('does not revoke a grant belonging to another file and treats missing grants as success', async () => {
    const owner = await createUser('owner@example.com');
    const targetFile = await createFile(owner.id);
    const otherFile = await createFile(owner.id, 'other.txt');
    const otherGrant = await saveGrant({
      fileId: otherFile.id,
      createdByUserId: owner.id,
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
    });

    await sharingService.revokeFileShare(owner, targetFile.publicId, otherGrant.publicId);
    await sharingService.revokeFileShare(owner, targetFile.publicId, randomUUID());

    const remainingGrants = await database.select().from(fileGrants);
    expect(remainingGrants).toHaveLength(1);
    expect(remainingGrants[0]?.publicId).toBe(otherGrant.publicId);
    expect(await database.select().from(auditEvents)).toHaveLength(0);
  });

  it('does not revoke a grant when the actor cannot manage the file sharing', async () => {
    const owner = await createUser('owner@example.com');
    const otherUser = await createUser('other@example.com');
    const file = await createFile(owner.id);
    const grant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
    });

    await expect(
      sharingService.revokeFileShare(otherUser, file.publicId, grant.publicId),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
    });

    const remainingGrants = await database.select().from(fileGrants);
    expect(remainingGrants).toHaveLength(1);
    expect(remainingGrants[0]?.publicId).toBe(grant.publicId);
    expect(await database.select().from(auditEvents)).toHaveLength(0);
  });

  it('partially updates an active grant while preserving its identity and omitted fields', async () => {
    const owner = await createUser('owner@example.com');
    const recipient = await createUser('recipient@example.com');
    const file = await createFile(owner.id);
    const originalExpiry = new Date('2026-08-05T10:00:00.000Z');
    const grant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: originalExpiry,
    });
    const permissionUpdatedAt = new Date('2026-08-01T11:00:00.000Z');

    const permissionUpdated = await unitOfWork.run((tx) =>
      repository.update(
        {
          fileId: file.id,
          grantPublicId: grant.publicId,
          permission: 'editor',
          expiresAt: undefined,
          updatedAt: permissionUpdatedAt,
        },
        tx,
      ),
    );

    expect(permissionUpdated?.updated).toMatchObject({
      id: grant.id,
      publicId: grant.publicId,
      permission: 'editor',
      expiresAt: originalExpiry,
      activationDeadline: null,
      updatedAt: permissionUpdatedAt,
    });

    const expiryClearedAt = new Date('2026-08-01T12:00:00.000Z');
    const expiryCleared = await unitOfWork.run((tx) =>
      repository.update(
        {
          fileId: file.id,
          grantPublicId: grant.publicId,
          permission: undefined,
          expiresAt: null,
          updatedAt: expiryClearedAt,
        },
        tx,
      ),
    );

    expect(expiryCleared?.updated).toMatchObject({
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
    const grant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: 'pending@example.com',
      permission: 'viewer',
      expiresAt: null,
    });
    const earlierExpiry = new Date('2026-08-01T12:00:00.000Z');

    const shortened = await unitOfWork.run((tx) =>
      repository.update(
        {
          fileId: file.id,
          grantPublicId: grant.publicId,
          permission: undefined,
          expiresAt: earlierExpiry,
          updatedAt: new Date('2026-08-01T11:00:00.000Z'),
        },
        tx,
      ),
    );

    expect(shortened?.updated).toMatchObject({
      expiresAt: earlierExpiry,
      activationDeadline: earlierExpiry,
    });

    const laterExpiry = new Date('2026-08-05T10:00:00.000Z');
    const extended = await unitOfWork.run((tx) =>
      repository.update(
        {
          fileId: file.id,
          grantPublicId: grant.publicId,
          permission: undefined,
          expiresAt: laterExpiry,
          updatedAt: new Date('2026-08-01T11:30:00.000Z'),
        },
        tx,
      ),
    );

    expect(extended?.updated).toMatchObject({
      expiresAt: laterExpiry,
      activationDeadline: earlierExpiry,
    });

    const expiryCleared = await unitOfWork.run((tx) =>
      repository.update(
        {
          fileId: file.id,
          grantPublicId: grant.publicId,
          permission: undefined,
          expiresAt: null,
          updatedAt: new Date('2026-08-01T11:45:00.000Z'),
        },
        tx,
      ),
    );

    expect(expiryCleared?.updated).toMatchObject({
      expiresAt: null,
      activationDeadline: earlierExpiry,
    });
  });

  it('returns null without changing a grant belonging to another file', async () => {
    const owner = await createUser('owner@example.com');
    const targetFile = await createFile(owner.id);
    const otherFile = await createFile(owner.id, 'other.txt');
    const otherGrant = await saveGrant({
      fileId: otherFile.id,
      createdByUserId: owner.id,
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
    });

    const result = await unitOfWork.run((tx) =>
      repository.update(
        {
          fileId: targetFile.id,
          grantPublicId: otherGrant.publicId,
          permission: 'editor',
          expiresAt: undefined,
          updatedAt: new Date('2026-08-01T11:00:00.000Z'),
        },
        tx,
      ),
    );

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
    const grant = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: recipient.email,
      permission: 'viewer',
      expiresAt: null,
    });

    await expect(
      sharingService.updateFileShare(recipient, file.publicId, grant.publicId, {
        permission: 'editor',
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
    expect(await database.select().from(auditEvents)).toHaveLength(0);
  });

  it('deletes expired pending grants and activates recipients available before the deadline', async () => {
    const owner = await createUser('owner@example.com');
    const file = await createFile(owner.id);
    const processedAt = PENDING_DEADLINE;
    const futureDeadline = new Date('2026-08-03T10:00:00.000Z');

    const expired = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: 'expired@example.com',
      permission: 'viewer',
      expiresAt: null,
      pendingActivationDeadline: processedAt,
    });
    const activatable = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: 'available@example.com',
      permission: 'editor',
      expiresAt: null,
      pendingActivationDeadline: futureDeadline,
    });
    const unresolved = await saveGrant({
      fileId: file.id,
      createdByUserId: owner.id,
      recipientEmail: 'unresolved@example.com',
      permission: 'viewer',
      expiresAt: null,
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
      await saveGrant({
        fileId: file.id,
        createdByUserId: owner.id,
        recipientEmail,
        permission: 'viewer',
        expiresAt: null,
        pendingActivationDeadline,
      });
    }

    for (const recipientEmail of ['available-first@example.com', 'available-second@example.com']) {
      await saveGrant({
        fileId: file.id,
        createdByUserId: owner.id,
        recipientEmail,
        permission: 'viewer',
        expiresAt: null,
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

  async function saveGrant(input: {
    fileId: number;
    createdByUserId: number;
    recipientEmail: string;
    permission: 'viewer' | 'editor';
    expiresAt: Date | null;
    submittedAt?: Date;
    pendingActivationDeadline?: Date;
  }) {
    return unitOfWork.run((tx) =>
      repository.save(
        {
          fileId: input.fileId,
          createdByUserId: input.createdByUserId,
          recipientEmail: input.recipientEmail,
          permission: input.permission,
          expiresAt: input.expiresAt,
          submittedAt: input.submittedAt ?? SUBMITTED_AT,
          pendingActivationDeadline: input.pendingActivationDeadline ?? PENDING_DEADLINE,
        },
        tx,
      ),
    );
  }

  async function createUser(email: string) {
    const [user] = await database
      .insert(users)
      .values({
        issuer: ISSUER,
        subject: randomUUID(),
        email,
        firstName: 'Test',
        lastName: 'User',
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
