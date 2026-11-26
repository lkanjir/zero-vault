import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditEvents,
  entries,
  fileGrants,
  files,
  objectDeletionJobs,
  uploadIntents,
  users,
} from '../../../src/db/schema.js';
import { AuthorizationPolicy } from '../../../src/authorization/authorization-policy.js';
import { AuthorizationService } from '../../../src/authorization/authorization-service.js';
import { PostgresAuthorizationContextResolver } from '../../../src/authorization/postgres-authorization-context-resolver.js';
import { PostgresEntryAuthorizer } from '../../../src/authorization/postgres-entry-authorizer.js';
import { createDatabase, type Database } from '../../../src/db/db-client.js';
import { PostgresIntentRepository } from '../../../src/upload/postgres-intent-repository.js';
import type {
  SaveReplacementUploadIntentCommand,
  SaveUploadIntentCommand,
} from '../../../src/upload/upload-intent-repository.js';
import type { UploadIntentInput } from '../../../src/upload/upload-intent.js';

const OWNER_ISSUER = 'https://issuer.example.test/realms/zero-vault';
const EXPECTED_SHA256 = 'a'.repeat(64);

describe('PostgresIntentRepository upload targets', () => {
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

    const dbHandle = createDatabase({ connectionString: container.getConnectionUri() });
    database = dbHandle.db;
    closeDatabase = dbHandle.close;
    const authorizationService = new AuthorizationService(
      new PostgresAuthorizationContextResolver(database),
      new AuthorizationPolicy(),
    );
    const entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    repository = new PostgresIntentRepository(database, entryAuthorizer);

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(auditEvents);
    await database.delete(objectDeletionJobs);
    await database.delete(uploadIntents);
    await database.delete(fileGrants);
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
        uploadId: intent.upload.uploadId,
        completedAt: new Date(),
      }),
    ).rejects.toMatchObject({
      code: 'duplicate_entry_name',
    });

    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, intent.upload.uploadId));

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
        uploadId: firstIntent.upload.uploadId,
        completedAt: new Date(),
      }),
      repository.completeVerifiedUpload({
        userId,
        uploadId: secondIntent.upload.uploadId,
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
      uploadId: intent.upload.uploadId,
      completedAt: new Date(),
    });
    const secondResult = await repository.completeVerifiedUpload({
      userId,
      uploadId: intent.upload.uploadId,
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
      .where(eq(uploadIntents.uploadId, intent.upload.uploadId));

    expect(storedEntries).toHaveLength(1);
    expect(storedFiles).toHaveLength(1);
    expect(storedIntent).toMatchObject({
      status: 'completed',
      fileId: storedEntries[0]?.id,
    });
  });

  it('does not complete an upload after its target folder is deleted', async () => {
    const userId = await createUser();
    const [folder] = await database
      .insert(entries)
      .values({
        ownerId: userId,
        parentId: null,
        kind: 'folder',
        name: 'Target folder',
      })
      .returning();

    if (!folder) {
      throw new Error('Failed to create target folder');
    }

    const intent = makeIntent(userId, 'report.pdf', folder.publicId);
    await repository.save(intent);
    await database.update(entries).set({ deletedAt: new Date() }).where(eq(entries.id, folder.id));

    await expect(
      repository.completeVerifiedUpload({
        userId,
        uploadId: intent.upload.uploadId,
        completedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'folder_not_found' });

    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, intent.upload.uploadId));
    const storedFiles = await database.select().from(files);
    const storedFileEntries = await database.select().from(entries).where(eq(entries.kind, 'file'));

    expect(storedIntent).toMatchObject({
      status: 'pending',
      fileId: null,
      targetParentId: folder.id,
      completedAt: null,
    });
    expect(storedFileEntries).toHaveLength(0);
    expect(storedFiles).toHaveLength(0);
  });

  it('replaces file content without changing the entry identity and queues the old object', async () => {
    const userId = await createUser();
    const target = await createFile(userId, {
      name: 'report.pdf',
      objectKey: 'objects/original',
      contentType: 'application/pdf',
      sizeBytes: 12,
      sha256: EXPECTED_SHA256,
    });
    const replacement = makeReplacementIntent(userId, target.entry.publicId, {
      objectKey: 'objects/replacement',
      contentType: 'text/plain',
      expectedSizeBytes: 24,
      expectedSha256: 'b'.repeat(64),
    });
    const completedAt = new Date('2026-08-08T11:05:00.000Z');

    await repository.saveReplacement(replacement);
    const firstResult = await repository.completeVerifiedUpload({
      userId,
      uploadId: replacement.upload.uploadId,
      completedAt,
    });
    const secondResult = await repository.completeVerifiedUpload({
      userId,
      uploadId: replacement.upload.uploadId,
      completedAt: new Date(completedAt.getTime() + 1_000),
    });

    expect(firstResult).toStrictEqual({
      kind: 'completed',
      file: {
        entryId: target.entry.id,
        publicId: target.entry.publicId,
        name: 'report.pdf',
        contentType: 'text/plain',
        sizeBytes: 24,
        updatedAt: completedAt,
      },
    });
    expect(secondResult).toStrictEqual(firstResult);

    const [storedEntry] = await database
      .select()
      .from(entries)
      .where(eq(entries.id, target.entry.id));
    const [storedFile] = await database
      .select()
      .from(files)
      .where(eq(files.entryId, target.entry.id));
    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, replacement.upload.uploadId));
    const deletionJobs = await database.select().from(objectDeletionJobs);

    expect(storedEntry).toMatchObject({
      id: target.entry.id,
      publicId: target.entry.publicId,
      name: 'report.pdf',
      updatedAt: completedAt,
    });
    expect(storedFile).toMatchObject({
      entryId: target.entry.id,
      objectKey: 'objects/replacement',
      contentType: 'text/plain',
      sizeBytes: 24,
      sha256: 'b'.repeat(64),
      contentVersion: 2,
    });
    expect(storedIntent).toMatchObject({
      status: 'completed',
      operation: 'replace',
      fileId: target.entry.id,
      targetFileId: target.entry.id,
      expectedContentVersion: 1,
      completedAt,
    });
    expect(deletionJobs).toHaveLength(1);
    expect(deletionJobs[0]).toMatchObject({
      objectKey: 'objects/original',
      reason: 'replaced_file',
    });
  });

  it('supersedes a stale replacement and queues only its unused uploaded object', async () => {
    const userId = await createUser();
    const target = await createFile(userId, {
      name: 'report.pdf',
      objectKey: 'objects/original',
    });
    const first = makeReplacementIntent(userId, target.entry.publicId, {
      objectKey: 'objects/first-replacement',
    });
    const stale = makeReplacementIntent(userId, target.entry.publicId, {
      objectKey: 'objects/stale-replacement',
    });

    await repository.saveReplacement(first);
    await repository.saveReplacement(stale);
    await expect(
      repository.completeVerifiedUpload({
        userId,
        uploadId: first.upload.uploadId,
        completedAt: new Date('2026-08-08T11:05:00.000Z'),
      }),
    ).resolves.toMatchObject({ kind: 'completed' });
    await expect(
      repository.completeVerifiedUpload({
        userId,
        uploadId: stale.upload.uploadId,
        completedAt: new Date('2026-08-08T11:05:01.000Z'),
      }),
    ).resolves.toStrictEqual({ kind: 'superseded' });
    await expect(
      repository.completeVerifiedUpload({
        userId,
        uploadId: stale.upload.uploadId,
        completedAt: new Date('2026-08-08T11:05:02.000Z'),
      }),
    ).resolves.toStrictEqual({ kind: 'superseded' });

    const [storedFile] = await database
      .select()
      .from(files)
      .where(eq(files.entryId, target.entry.id));
    const [staleIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, stale.upload.uploadId));
    const deletionJobs = await database.select().from(objectDeletionJobs);

    expect(storedFile).toMatchObject({
      objectKey: 'objects/first-replacement',
      contentVersion: 2,
    });
    expect(staleIntent).toMatchObject({
      status: 'superseded',
      fileId: null,
      completedAt: null,
    });
    expect(deletionJobs).toHaveLength(2);
    expect(deletionJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKey: 'objects/original',
          reason: 'replaced_file',
        }),
        expect.objectContaining({
          objectKey: 'objects/stale-replacement',
          reason: 'superseded_upload',
        }),
      ]),
    );
  });

  it('does not complete an editor replacement after its grant is revoked', async () => {
    const ownerId = await createUser();
    const editorId = await createUser();
    const target = await createFile(ownerId, {
      name: 'shared.pdf',
      objectKey: 'objects/shared-original',
    });
    const [editor] = await database.select().from(users).where(eq(users.id, editorId));

    if (!editor) {
      throw new Error('Failed to load integration test editor');
    }

    await database.insert(fileGrants).values({
      fileId: target.entry.id,
      recipientUserId: editorId,
      recipientEmail: editor.email,
      createdByUserId: ownerId,
      permission: 'editor',
    });

    const replacement = makeReplacementIntent(editorId, target.entry.publicId, {
      objectKey: 'objects/editor-replacement',
    });
    await repository.saveReplacement(replacement);
    await database.delete(fileGrants).where(eq(fileGrants.fileId, target.entry.id));

    await expect(
      repository.completeVerifiedUpload({
        userId: editorId,
        uploadId: replacement.upload.uploadId,
        completedAt: new Date('2026-08-08T11:05:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'entry_not_found' });

    const [storedFile] = await database
      .select()
      .from(files)
      .where(eq(files.entryId, target.entry.id));
    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, replacement.upload.uploadId));

    expect(storedFile).toMatchObject({
      objectKey: 'objects/shared-original',
      contentVersion: 1,
    });
    expect(storedIntent).toMatchObject({ status: 'pending' });
    expect(await database.select().from(objectDeletionJobs)).toHaveLength(0);
  });

  async function createUser(): Promise<number> {
    const [user] = await database
      .insert(users)
      .values({
        issuer: OWNER_ISSUER,
        subject: randomUUID(),
        email: `${randomUUID()}@example.com`,
        firstName: 'Test',
        lastName: 'User',
      })
      .returning({ id: users.id });

    if (!user) {
      throw new Error('Failed to create integration test user');
    }

    return user.id;
  }

  async function createFile(
    ownerId: number,
    options: {
      name: string;
      objectKey: string;
      contentType?: string;
      sizeBytes?: number;
      sha256?: string;
    },
  ) {
    const [entry] = await database
      .insert(entries)
      .values({
        ownerId,
        parentId: null,
        kind: 'file',
        name: options.name,
      })
      .returning();

    if (!entry) {
      throw new Error('Failed to create integration test file entry');
    }

    const [file] = await database
      .insert(files)
      .values({
        entryId: entry.id,
        objectKey: options.objectKey,
        contentType: options.contentType ?? 'application/pdf',
        sizeBytes: options.sizeBytes ?? 12,
        sha256: options.sha256 ?? EXPECTED_SHA256,
      })
      .returning();

    if (!file) {
      throw new Error('Failed to create integration test file metadata');
    }

    return { entry, file };
  }
});

function makeIntent(
  userId: number,
  fileName: string,
  parentFolderId: string | null = null,
): SaveUploadIntentCommand {
  const createdAt = new Date();
  const upload: UploadIntentInput = {
    uploadId: randomUUID(),
    createdByUserId: userId,
    objectKey: `integration-tests/${randomUUID()}`,
    contentType: 'application/pdf',
    expectedSizeBytes: 12,
    expectedSha256: EXPECTED_SHA256,
    createdAt,
    uploadUrlExpiresAt: new Date(createdAt.getTime() + 60_000),
    finalizeDeadline: new Date(createdAt.getTime() + 600_000),
  };

  return {
    upload,
    parentFolderId,
    fileName,
  };
}

function makeReplacementIntent(
  userId: number,
  filePublicId: string,
  overrides: Partial<UploadIntentInput> = {},
): SaveReplacementUploadIntentCommand {
  const createdAt = new Date('2026-08-08T11:00:00.000Z');

  return {
    filePublicId,
    upload: {
      uploadId: randomUUID(),
      createdByUserId: userId,
      objectKey: `integration-tests/${randomUUID()}`,
      contentType: 'application/pdf',
      expectedSizeBytes: 12,
      expectedSha256: EXPECTED_SHA256,
      createdAt,
      uploadUrlExpiresAt: new Date(createdAt.getTime() + 60_000),
      finalizeDeadline: new Date(createdAt.getTime() + 600_000),
      ...overrides,
    },
  };
}
