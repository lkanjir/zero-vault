import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AuditRepository } from '../../../src/audit/audit-repository.js';
import { PostgresAuditRepository } from '../../../src/audit/postgres-audit-repository.js';
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
import { DrizzleUnitOfWork } from '../../../src/db/unit-of-work.js';
import type { ObjectMetadata, ObjectStorage } from '../../../src/storage/object-storage.js';
import { PostgresIntentRepository } from '../../../src/upload/postgres-intent-repository.js';
import type {
  SaveReplacementUploadIntentCommand,
  SaveUploadIntentCommand,
} from '../../../src/upload/upload-intent-repository.js';
import type { UploadIntentInput } from '../../../src/upload/upload-intent.js';
import { UploadService } from '../../../src/upload/upload-service.js';
import type { User } from '../../../src/user/user.js';

const OWNER_ISSUER = 'https://issuer.example.test/realms/zero-vault';
const EXPECTED_SHA256 = 'a'.repeat(64);

describe('PostgresIntentRepository and UploadService transactions', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let unitOfWork: DrizzleUnitOfWork;
  let entryAuthorizer: PostgresEntryAuthorizer;
  let auditRepository: PostgresAuditRepository;
  let repository: PostgresIntentRepository;
  let uploadService: UploadService;
  const uploadedObjects = new Map<string, ObjectMetadata>();

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
    unitOfWork = new DrizzleUnitOfWork(database);
    entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    auditRepository = new PostgresAuditRepository(database);
    repository = new PostgresIntentRepository(database);
    uploadService = new UploadService(
      unitOfWork,
      entryAuthorizer,
      createInMemoryStorage(uploadedObjects),
      repository,
      auditRepository,
    );

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    uploadedObjects.clear();
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
    const user = await createUser();

    await database.insert(entries).values({
      ownerId: user.id,
      parentId: null,
      kind: 'folder',
      name: 'Report.PDF',
    });

    await expect(
      uploadService.createUpload(user, {
        parentFolderId: null,
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 12,
        sha256: EXPECTED_SHA256,
      }),
    ).rejects.toMatchObject({ code: 'duplicate_entry_name' });
  });

  it('precheck ignores a soft-deleted sibling', async () => {
    const user = await createUser();

    await database.insert(entries).values({
      ownerId: user.id,
      parentId: null,
      kind: 'file',
      name: 'report.pdf',
      deletedAt: new Date(),
    });

    await expect(
      uploadService.createUpload(user, {
        parentFolderId: null,
        fileName: 'REPORT.PDF',
        contentType: 'application/pdf',
        size: 12,
        sha256: EXPECTED_SHA256,
      }),
    ).resolves.toMatchObject({
      uploadUrl: 'https://storage.example.test/upload',
    });
  });

  it('supersedes a duplicate create completion, queues object deletion, and leaves no partial file', async () => {
    const user = await createUser();

    await database.insert(entries).values({
      ownerId: user.id,
      parentId: null,
      kind: 'folder',
      name: 'Report.PDF',
    });

    const intent = makeIntent(user.id, 'report.pdf');
    await saveCreateIntent(intent);

    await expect(uploadService.completeUpload(user, intent.upload.uploadId)).rejects.toMatchObject({
      code: 'duplicate_entry_name',
    });
    await expect(uploadService.completeUpload(user, intent.upload.uploadId)).rejects.toMatchObject({
      code: 'duplicate_entry_name',
    });

    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, intent.upload.uploadId));
    const deletionJobs = await database.select().from(objectDeletionJobs);

    expect(storedIntent).toMatchObject({
      status: 'superseded',
      fileId: null,
      completedAt: null,
    });
    expect(deletionJobs).toHaveLength(1);
    expect(deletionJobs[0]).toMatchObject({
      objectKey: intent.upload.objectKey,
      reason: 'superseded_upload',
    });

    const storedEntries = await database.select().from(entries).where(eq(entries.ownerId, user.id));
    const storedFiles = await database.select().from(files);

    expect(storedEntries).toHaveLength(1);
    expect(storedFiles).toHaveLength(0);
    expect(await database.select().from(auditEvents)).toHaveLength(0);
  });

  it('rolls back file creation and intent completion when audit recording fails', async () => {
    const user = await createUser();
    const intent = makeIntent(user.id, 'report.pdf');
    await saveCreateIntent(intent);

    const failingAuditRepo: AuditRepository = {
      record: () => Promise.reject(new Error('audit write failed')),
      listEvents: () => Promise.resolve([]),
      getStatistics: () =>
        Promise.resolve({ total: 0, entryChanges: 0, downloadRequests: 0, sharingChanges: 0 }),
    };
    const serviceWithFailingAudit = new UploadService(
      unitOfWork,
      entryAuthorizer,
      createInMemoryStorage(uploadedObjects),
      repository,
      failingAuditRepo,
    );

    await expect(
      serviceWithFailingAudit.completeUpload(user, intent.upload.uploadId),
    ).rejects.toThrow('audit write failed');

    const [storedIntent] = await database
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, intent.upload.uploadId));
    expect(storedIntent).toMatchObject({
      status: 'pending',
      fileId: null,
      completedAt: null,
    });
    expect(await database.select().from(entries)).toHaveLength(0);
    expect(await database.select().from(files)).toHaveLength(0);
  });

  it('allows only one of two concurrent completions with the same target name', async () => {
    const user = await createUser();
    const firstIntent = makeIntent(user.id, 'report.pdf');
    const secondIntent = makeIntent(user.id, 'REPORT.PDF');

    await saveCreateIntent(firstIntent);
    await saveCreateIntent(secondIntent);

    const results = await Promise.allSettled([
      uploadService.completeUpload(user, firstIntent.upload.uploadId),
      uploadService.completeUpload(user, secondIntent.upload.uploadId),
    ]);

    expect(results.map((result) => result.status).sort()).toStrictEqual(['fulfilled', 'rejected']);

    const successfulResult = results.find((result) => result.status === 'fulfilled');
    const failedResult = results.find((result) => result.status === 'rejected');

    expect(successfulResult).toMatchObject({
      value: { kind: 'file' },
    });
    expect(failedResult).toMatchObject({
      reason: {
        code: 'duplicate_entry_name',
      },
    });

    const storedEntries = await database.select().from(entries).where(eq(entries.ownerId, user.id));
    const storedFiles = await database.select().from(files);
    const storedIntents = await database
      .select({ status: uploadIntents.status, objectKey: uploadIntents.objectKey })
      .from(uploadIntents);
    const deletionJobs = await database.select().from(objectDeletionJobs);
    const supersededIntent = storedIntents.find((intent) => intent.status === 'superseded');

    expect(storedEntries).toHaveLength(1);
    expect(storedFiles).toHaveLength(1);
    expect(storedIntents.map((intent) => intent.status).sort()).toStrictEqual([
      'completed',
      'superseded',
    ]);
    expect(deletionJobs).toHaveLength(1);
    expect(deletionJobs[0]).toMatchObject({
      objectKey: supersededIntent?.objectKey,
      reason: 'superseded_upload',
    });
    expect(await database.select().from(auditEvents)).toHaveLength(1);
  });

  it('returns the same file when an upload is completed more than once without duplicating audit', async () => {
    const user = await createUser();
    const intent = makeIntent(user.id, 'report.pdf');
    await saveCreateIntent(intent);

    const firstResult = await uploadService.completeUpload(user, intent.upload.uploadId);
    const secondResult = await uploadService.completeUpload(user, intent.upload.uploadId);

    expect(secondResult).toStrictEqual(firstResult);

    const storedEntries = await database.select().from(entries).where(eq(entries.ownerId, user.id));
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
    expect(await database.select().from(auditEvents)).toHaveLength(1);
  });

  it('does not complete an upload after its target folder is deleted', async () => {
    const user = await createUser();
    const [folder] = await database
      .insert(entries)
      .values({
        ownerId: user.id,
        parentId: null,
        kind: 'folder',
        name: 'Target folder',
      })
      .returning();

    if (!folder) {
      throw new Error('Failed to create target folder');
    }

    const intent = makeIntent(user.id, 'report.pdf', folder.id);
    await saveCreateIntent(intent);
    await database.update(entries).set({ deletedAt: new Date() }).where(eq(entries.id, folder.id));

    await expect(uploadService.completeUpload(user, intent.upload.uploadId)).rejects.toMatchObject({
      code: 'folder_not_found',
    });

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
    expect(await database.select().from(auditEvents)).toHaveLength(0);
  });

  it('replaces file content without changing the entry identity and queues the old object', async () => {
    const user = await createUser();
    const target = await createFile(user.id, {
      name: 'report.pdf',
      objectKey: 'objects/original',
      contentType: 'application/pdf',
      sizeBytes: 12,
      sha256: EXPECTED_SHA256,
    });
    const replacement = makeReplacementIntent(user.id, target.entry.id, {
      objectKey: 'objects/replacement',
      contentType: 'text/plain',
      expectedSizeBytes: 24,
      expectedSha256: 'b'.repeat(64),
    });

    await saveReplaceIntent(replacement);
    const firstResult = await uploadService.completeUpload(user, replacement.upload.uploadId);
    const secondResult = await uploadService.completeUpload(user, replacement.upload.uploadId);

    expect(firstResult).toMatchObject({
      kind: 'file',
      id: target.entry.publicId,
      name: 'report.pdf',
      contentType: 'text/plain',
      sizeBytes: 24,
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
    const events = await database.select().from(auditEvents);

    expect(storedEntry).toMatchObject({
      id: target.entry.id,
      publicId: target.entry.publicId,
      name: 'report.pdf',
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
    });
    expect(deletionJobs).toHaveLength(1);
    expect(deletionJobs[0]).toMatchObject({
      objectKey: 'objects/original',
      reason: 'replaced_file',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ownerId: user.id,
      actorUserId: user.id,
      entryId: target.entry.id,
      action: 'file.content_replaced',
    });
  });

  it('rolls back file replacement, intent completion, and object deletion enqueue when audit recording fails', async () => {
    const user = await createUser();
    const target = await createFile(user.id, {
      name: 'report.pdf',
      objectKey: 'objects/original',
      contentType: 'application/pdf',
      sizeBytes: 12,
      sha256: EXPECTED_SHA256,
    });
    const originalUpdatedAt = target.entry.updatedAt;
    const replacement = makeReplacementIntent(user.id, target.entry.id, {
      objectKey: 'objects/replacement',
      contentType: 'text/plain',
      expectedSizeBytes: 24,
      expectedSha256: 'b'.repeat(64),
    });

    await saveReplaceIntent(replacement);

    const failingAuditRepo: AuditRepository = {
      record: () => Promise.reject(new Error('audit write failed')),
      listEvents: () => Promise.resolve([]),
      getStatistics: () =>
        Promise.resolve({ total: 0, entryChanges: 0, downloadRequests: 0, sharingChanges: 0 }),
    };
    const serviceWithFailingAudit = new UploadService(
      unitOfWork,
      entryAuthorizer,
      createInMemoryStorage(uploadedObjects),
      repository,
      failingAuditRepo,
    );

    await expect(
      serviceWithFailingAudit.completeUpload(user, replacement.upload.uploadId),
    ).rejects.toThrow('audit write failed');

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

    expect(storedEntry?.updatedAt).toEqual(originalUpdatedAt);
    expect(storedFile).toMatchObject({
      objectKey: 'objects/original',
      contentType: 'application/pdf',
      sizeBytes: 12,
      sha256: EXPECTED_SHA256,
      contentVersion: 1,
    });
    expect(storedIntent).toMatchObject({
      status: 'pending',
      fileId: null,
      completedAt: null,
    });
    expect(await database.select().from(objectDeletionJobs)).toHaveLength(0);
    expect(await database.select().from(auditEvents)).toHaveLength(0);
  });

  it('supersedes a stale replacement and queues only its unused uploaded object', async () => {
    const user = await createUser();
    const target = await createFile(user.id, {
      name: 'report.pdf',
      objectKey: 'objects/original',
    });
    const first = makeReplacementIntent(user.id, target.entry.id, {
      objectKey: 'objects/first-replacement',
    });
    const stale = makeReplacementIntent(user.id, target.entry.id, {
      objectKey: 'objects/stale-replacement',
    });

    await saveReplaceIntent(first);
    await saveReplaceIntent(stale);
    await expect(uploadService.completeUpload(user, first.upload.uploadId)).resolves.toMatchObject({
      kind: 'file',
    });
    await expect(uploadService.completeUpload(user, stale.upload.uploadId)).rejects.toMatchObject({
      code: 'replacement_conflict',
    });
    await expect(uploadService.completeUpload(user, stale.upload.uploadId)).rejects.toMatchObject({
      code: 'replacement_conflict',
    });

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
    const owner = await createUser();
    const editor = await createUser();
    const target = await createFile(owner.id, {
      name: 'shared.pdf',
      objectKey: 'objects/shared-original',
    });

    await database.insert(fileGrants).values({
      fileId: target.entry.id,
      recipientUserId: editor.id,
      recipientEmail: editor.email,
      createdByUserId: owner.id,
      permission: 'editor',
    });

    const replacement = makeReplacementIntent(editor.id, target.entry.id, {
      objectKey: 'objects/editor-replacement',
    });
    await saveReplaceIntent(replacement);
    await database.delete(fileGrants).where(eq(fileGrants.fileId, target.entry.id));

    await expect(
      uploadService.completeUpload(editor, replacement.upload.uploadId),
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
    expect(await database.select().from(auditEvents)).toHaveLength(0);
  });

  async function saveCreateIntent(command: SaveUploadIntentCommand): Promise<void> {
    uploadedObjects.set(command.upload.objectKey, {
      objectKey: command.upload.objectKey,
      sizeBytes: command.upload.expectedSizeBytes,
      contentType: command.upload.contentType,
      sha256Hex: command.upload.expectedSha256,
    });
    await unitOfWork.run((tx) => repository.save(command, tx));
  }

  async function saveReplaceIntent(command: SaveReplacementUploadIntentCommand): Promise<void> {
    uploadedObjects.set(command.upload.objectKey, {
      objectKey: command.upload.objectKey,
      sizeBytes: command.upload.expectedSizeBytes,
      contentType: command.upload.contentType,
      sha256Hex: command.upload.expectedSha256,
    });
    await unitOfWork.run((tx) => repository.saveReplacement(command, tx));
  }

  async function createUser(): Promise<User> {
    const [user] = await database
      .insert(users)
      .values({
        issuer: OWNER_ISSUER,
        subject: randomUUID(),
        email: `${randomUUID()}@example.com`,
        firstName: 'Test',
        lastName: 'User',
      })
      .returning();

    if (!user) {
      throw new Error('Failed to create integration test user');
    }

    return user;
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

function createInMemoryStorage(objects: Map<string, ObjectMetadata>): ObjectStorage {
  return {
    createPresignedUploadUrl: () => Promise.resolve('https://storage.example.test/upload'),
    createPresignedDownloadUrl: () => Promise.resolve('https://storage.example.test/download'),
    headObject: (objectKey) => {
      const metadata = objects.get(objectKey);
      if (!metadata) {
        return Promise.reject(new Error(`Missing test object ${objectKey}`));
      }
      return Promise.resolve(metadata);
    },
    deleteObject: () => Promise.resolve(),
    getObjectStream: () => Promise.reject(new Error('not implemented')),
    uploadObjectStream: () => Promise.resolve(),
  };
}

function makeIntent(
  userId: number,
  fileName: string,
  targetParentId: number | null = null,
): SaveUploadIntentCommand {
  const createdAt = new Date();
  const upload: UploadIntentInput = {
    uploadId: randomUUID(),
    createdByUserId: userId,
    objectKey: `integration-tests/${randomUUID()}`,
    contentType: 'application/pdf',
    expectedSizeBytes: 12,
    expectedSha256: EXPECTED_SHA256,
    uploadMode: 'single',
    s3UploadId: null,
    partSizeBytes: null,
    partCount: null,
    checksumType: 'full_sha256',
    createdAt,
    uploadUrlExpiresAt: new Date(createdAt.getTime() + 60_000),
    finalizeDeadline: new Date(createdAt.getTime() + 600_000),
  };

  return {
    upload,
    targetParentId,
    fileName,
  };
}

function makeReplacementIntent(
  userId: number,
  targetFileId: number,
  overrides: Partial<UploadIntentInput> = {},
): SaveReplacementUploadIntentCommand {
  const createdAt = new Date();

  return {
    targetFileId,
    upload: {
      uploadId: randomUUID(),
      createdByUserId: userId,
      objectKey: `integration-tests/${randomUUID()}`,
      contentType: 'application/pdf',
      expectedSizeBytes: 12,
      expectedSha256: EXPECTED_SHA256,
      uploadMode: 'single',
      s3UploadId: null,
      partSizeBytes: null,
      partCount: null,
      checksumType: 'full_sha256',
      createdAt,
      uploadUrlExpiresAt: new Date(createdAt.getTime() + 60_000),
      finalizeDeadline: new Date(createdAt.getTime() + 600_000),
      ...overrides,
    },
  };
}
