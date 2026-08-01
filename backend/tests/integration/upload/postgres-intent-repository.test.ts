import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { entries, files, uploadIntents, users } from '../../../src/db/schema.js';
import type { Database } from '../../../src/db/db-client.js';
import type { PostgresIntentRepository } from '../../../src/upload/postgres-intent-repository.js';
import type { SaveUploadIntentCommand } from '../../../src/upload/upload-intent-repository.js';

const OWNER_ISSUER = 'https://issuer.example.test/realms/zero-vault';
const EXPECTED_SHA256 = 'a'.repeat(64);

describe('PostgresIntentRepository duplicate names', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let repository: PostgresIntentRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('zero_vault_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    process.env['DATABASE_URL'] = container.getConnectionUri();

    const [
      databaseModule,
      repositoryModule,
      contextResolverModule,
      policyModule,
      authorizationServiceModule,
      entryAuthorizerModule,
    ] = await Promise.all([
      import('../../../src/db/db-client.js'),
      import('../../../src/upload/postgres-intent-repository.js'),
      import('../../../src/authorization/postgres-authorization-context-resolver.js'),
      import('../../../src/authorization/authorization-policy.js'),
      import('../../../src/authorization/authorization-service.js'),
      import('../../../src/authorization/postgres-entry-authorizer.js'),
    ]);

    database = databaseModule.db;
    closeDatabase = databaseModule.closeDatabase;
    const authorizationService = new authorizationServiceModule.AuthorizationService(
      new contextResolverModule.PostgresAuthorizationContextResolver(),
      new policyModule.AuthorizationPolicy(),
    );
    const entryAuthorizer = new entryAuthorizerModule.PostgresEntryAuthorizer(authorizationService);
    repository = new repositoryModule.PostgresIntentRepository(entryAuthorizer);

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(uploadIntents);
    await database.delete(files);
    await database.delete(entries);
    await database.delete(users);
  });

  afterAll(async () => {
    await closeDatabase();
    await container.stop();
  });

  it('precheck rejects an active case-insensitive sibling name in root', async () => {
    const userId = await createUser();

    await database.insert(entries).values({
      ownerId: userId,
      parentId: null,
      kind: 'folder',
      name: 'Report.PDF',
    });

    await expect(
      repository.assertUploadTargetAvailable({
        userId,
        parentFolderId: null,
        fileName: 'report.pdf',
      }),
    ).rejects.toMatchObject({ code: 'duplicate_entry_name' });
  });

  it('precheck ignores a soft-deleted sibling', async () => {
    const userId = await createUser();

    await database.insert(entries).values({
      ownerId: userId,
      parentId: null,
      kind: 'file',
      name: 'report.pdf',
      deletedAt: new Date(),
    });

    await expect(
      repository.assertUploadTargetAvailable({
        userId,
        parentFolderId: null,
        fileName: 'REPORT.PDF',
      }),
    ).resolves.toBeUndefined();
  });

  it('maps a completion duplicate to duplicate_entry_name and rolls back all changes', async () => {
    const userId = await createUser();

    await database.insert(entries).values({
      ownerId: userId,
      parentId: null,
      kind: 'folder',
      name: 'Report.PDF',
    });

    const intent = makeIntent(userId, 'report.pdf');
    await repository.save(intent);

    await expect(
      repository.completeVerifiedUpload({
        userId,
        uploadId: intent.uploadId,
        completedAt: new Date(),
      }),
    ).rejects.toMatchObject({
      code: 'duplicate_entry_name',
    });

    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, intent.uploadId));

    expect(storedIntent).toMatchObject({
      status: 'pending',
      fileId: null,
      completedAt: null,
    });

    const storedEntries = await database.select().from(entries).where(eq(entries.ownerId, userId));
    const storedFiles = await database.select().from(files);

    expect(storedEntries).toHaveLength(1);
    expect(storedFiles).toHaveLength(0);
  });

  it('allows only one of two concurrent completions with the same target name', async () => {
    const userId = await createUser();
    const firstIntent = makeIntent(userId, 'report.pdf');
    const secondIntent = makeIntent(userId, 'REPORT.PDF');

    await repository.save(firstIntent);
    await repository.save(secondIntent);

    const results = await Promise.allSettled([
      repository.completeVerifiedUpload({
        userId,
        uploadId: firstIntent.uploadId,
        completedAt: new Date(),
      }),
      repository.completeVerifiedUpload({
        userId,
        uploadId: secondIntent.uploadId,
        completedAt: new Date(),
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toStrictEqual(['fulfilled', 'rejected']);

    const successfulResult = results.find((result) => result.status === 'fulfilled');
    const failedResult = results.find((result) => result.status === 'rejected');

    expect(successfulResult).toMatchObject({
      value: { kind: 'completed' },
    });
    expect(failedResult).toMatchObject({
      reason: {
        code: 'duplicate_entry_name',
      },
    });

    const storedEntries = await database.select().from(entries).where(eq(entries.ownerId, userId));
    const storedFiles = await database.select().from(files);
    const storedIntents = await database
      .select({ status: uploadIntents.status })
      .from(uploadIntents);

    expect(storedEntries).toHaveLength(1);
    expect(storedFiles).toHaveLength(1);
    expect(storedIntents.map((intent) => intent.status).sort()).toStrictEqual([
      'completed',
      'pending',
    ]);
  });

  it('returns the same file when an upload is completed more than once', async () => {
    const userId = await createUser();
    const intent = makeIntent(userId, 'report.pdf');
    await repository.save(intent);

    const firstResult = await repository.completeVerifiedUpload({
      userId,
      uploadId: intent.uploadId,
      completedAt: new Date(),
    });
    const secondResult = await repository.completeVerifiedUpload({
      userId,
      uploadId: intent.uploadId,
      completedAt: new Date(),
    });

    if (firstResult.kind !== 'completed' || secondResult.kind !== 'completed') {
      throw new Error('Expected both completion attempts to return the completed file');
    }

    expect(secondResult.file).toStrictEqual(firstResult.file);

    const storedEntries = await database.select().from(entries).where(eq(entries.ownerId, userId));
    const storedFiles = await database.select().from(files);
    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, intent.uploadId));

    expect(storedEntries).toHaveLength(1);
    expect(storedFiles).toHaveLength(1);
    expect(storedIntent).toMatchObject({
      status: 'completed',
      fileId: storedEntries[0]?.id,
    });
  });

  async function createUser(): Promise<number> {
    const [user] = await database
      .insert(users)
      .values({
        issuer: OWNER_ISSUER,
        subject: randomUUID(),
        username: 'test',
      })
      .returning({ id: users.id });

    if (!user) {
      throw new Error('Failed to create integration test user');
    }

    return user.id;
  }
});

function makeIntent(userId: number, fileName: string): SaveUploadIntentCommand {
  const createdAt = new Date();

  return {
    uploadId: randomUUID(),
    createdByUserId: userId,
    parentFolderId: null,
    fileId: null,
    fileName,
    objectKey: `integration-tests/${randomUUID()}`,
    contentType: 'application/pdf',
    expectedSizeBytes: 12,
    expectedSha256: EXPECTED_SHA256,
    status: 'pending',
    createdAt,
    uploadUrlExpiresAt: new Date(createdAt.getTime() + 60_000),
    finalizeDeadline: new Date(createdAt.getTime() + 600_000),
    completedAt: null,
  };
}
