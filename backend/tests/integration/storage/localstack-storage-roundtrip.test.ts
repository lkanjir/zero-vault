import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { CreateBucketCommand, S3Client, type BucketLocationConstraint } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  entries,
  fileGrants,
  objectDeletionJobs,
  uploadIntents,
  users,
} from '../../../src/db/schema.js';
import type { Database } from '../../../src/db/db-client.js';
import type { PostgresEntryRepository } from '../../../src/entry/postgres-entry-repository.js';
import type { FileDownloadService } from '../../../src/files/file-download-service.js';
import type { ObjectDeletionProcessor } from '../../../src/object-deletion/object-deletion-processor.js';
import type { PostgresObjectDeletionRepository } from '../../../src/object-deletion/postgres-object-deletion-repository.js';
import { StorageObjectNotFoundError } from '../../../src/shared/errors/storage/storage-object-not-found-error.js';
import type { S3ObjectStorage } from '../../../src/storage/s3-object-storage.js';
import type { CompleteUploadUseCase } from '../../../src/upload/complete-upload-use-case.js';
import type { PostgresIntentRepository } from '../../../src/upload/postgres-intent-repository.js';
import type { UploadService } from '../../../src/upload/upload-service.js';
import type { User } from '../../../src/user/user.js';

const REGION = 'eu-central-1';
const ACCESS_KEY = 'test';
const SECRET_KEY = 'test';
const BUCKET = 'zero-vault-roundtrip';
const ISSUER = 'https://issuer.example.test/realms/zero-vault';

describe('LocalStack storage round-trip', () => {
  let postgres: StartedPostgreSqlContainer;
  let localstack: StartedTestContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let uploadService: UploadService;
  let completeUpload: CompleteUploadUseCase;
  let fileDownloadService: FileDownloadService;
  let entryRepository: PostgresEntryRepository;
  let deletionRepository: PostgresObjectDeletionRepository;
  let deletionProcessor: ObjectDeletionProcessor;
  let storage: S3ObjectStorage;

  beforeAll(async () => {
    [postgres, localstack] = await Promise.all([
      new PostgreSqlContainer('postgres:18-alpine')
        .withDatabase('zero_vault_test')
        .withUsername('test')
        .withPassword('test')
        .start(),
      new GenericContainer('localstack/localstack:4.6.0')
        .withEnvironment({
          SERVICES: 's3',
          AWS_DEFAULT_REGION: REGION,
          S3_SKIP_SIGNATURE_VALIDATION: '0',
        })
        .withExposedPorts(4566)
        .withWaitStrategy(Wait.forHttp('/_localstack/health', 4566).forStatusCode(200))
        .withStartupTimeout(120_000)
        .start(),
    ]);

    const endpoint = `http://${localstack.getHost()}:${localstack.getMappedPort(4566)}`;
    Object.assign(process.env, {
      DATABASE_URL: postgres.getConnectionUri(),
      S3_ENDPOINT: endpoint,
      S3_REGION: REGION,
      S3_FORCE_PATH_STYLE: 'true',
      S3_ACCESS_KEY_ID: ACCESS_KEY,
      S3_SECRET_ACCESS_KEY: SECRET_KEY,
      S3_BUCKET: BUCKET,
    });

    const client = new S3Client({
      endpoint,
      region: REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
      },
    });
    await client.send(
      new CreateBucketCommand({
        Bucket: BUCKET,
        CreateBucketConfiguration: {
          LocationConstraint: REGION as BucketLocationConstraint,
        },
      }),
    );
    client.destroy();

    const [
      databaseModule,
      storageModule,
      intentRepositoryModule,
      uploadServiceModule,
      completeUploadModule,
      fileRepositoryModule,
      fileDownloadModule,
      entryRepositoryModule,
      deletionRepositoryModule,
      deletionProcessorModule,
      authorizationContextResolverModule,
      authorizationPolicyModule,
      authorizationServiceModule,
      entryAuthorizerModule,
      auditRepositoryModule,
    ] = await Promise.all([
      import('../../../src/db/db-client.js'),
      import('../../../src/storage/s3-object-storage.js'),
      import('../../../src/upload/postgres-intent-repository.js'),
      import('../../../src/upload/upload-service.js'),
      import('../../../src/upload/complete-upload-use-case.js'),
      import('../../../src/files/postgres-file-repository.js'),
      import('../../../src/files/file-download-service.js'),
      import('../../../src/entry/postgres-entry-repository.js'),
      import('../../../src/object-deletion/postgres-object-deletion-repository.js'),
      import('../../../src/object-deletion/object-deletion-processor.js'),
      import('../../../src/authorization/postgres-authorization-context-resolver.js'),
      import('../../../src/authorization/authorization-policy.js'),
      import('../../../src/authorization/authorization-service.js'),
      import('../../../src/authorization/postgres-entry-authorizer.js'),
      import('../../../src/audit/postgres-audit-repository.js'),
    ]);

    database = databaseModule.db;
    closeDatabase = databaseModule.closeDatabase;
    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });

    storage = new storageModule.S3ObjectStorage({
      endpoint,
      publicOrigin: endpoint,
      region: REGION,
      forcePathStyle: true,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      bucket: BUCKET,
    });
    const authorizationContextResolver =
      new authorizationContextResolverModule.PostgresAuthorizationContextResolver();
    const authorizationPolicy = new authorizationPolicyModule.AuthorizationPolicy();
    const authorizationService = new authorizationServiceModule.AuthorizationService(
      authorizationContextResolver,
      authorizationPolicy,
    );
    const entryAuthorizer = new entryAuthorizerModule.PostgresEntryAuthorizer(authorizationService);
    const intentRepository: PostgresIntentRepository =
      new intentRepositoryModule.PostgresIntentRepository(entryAuthorizer);
    uploadService = new uploadServiceModule.UploadService(storage, intentRepository);
    completeUpload = new completeUploadModule.CompleteUploadUseCase(uploadService);
    fileDownloadService = new fileDownloadModule.FileDownloadService(
      authorizationService,
      new fileRepositoryModule.PostgresFileRepository(),
      new auditRepositoryModule.PostgresAuditRepository(),
      storage,
    );
    entryRepository = new entryRepositoryModule.PostgresEntryRepository(entryAuthorizer);
    deletionRepository = new deletionRepositoryModule.PostgresObjectDeletionRepository();
    deletionProcessor = new deletionProcessorModule.ObjectDeletionProcessor(
      deletionRepository,
      storage,
    );
  });

  afterAll(async () => {
    await closeDatabase();
    await Promise.all([postgres.stop(), localstack.stop()]);
  });

  it('uploads, authorizes owner and viewer downloads, expires access and deletes one file', async () => {
    const user = await createUser('roundtrip-owner');
    const recipient = await createUser('roundtrip-recipient');
    const content = Buffer.from('LocalStack storage round-trip');
    const sha256 = createHash('sha256').update(content).digest('hex');

    const presign = await uploadService.createUpload(user, {
      parentFolderId: null,
      fileName: 'roundtrip.txt',
      contentType: 'text/plain',
      size: content.length,
      sha256,
    });

    const putResponse = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.requiredHeaders,
      body: content,
    });
    expect(putResponse.status, await putResponse.text()).toBe(200);

    const file = await completeUpload.execute(user, presign.uploadId);
    expect(file).toMatchObject({
      kind: 'file',
      name: 'roundtrip.txt',
      contentType: 'text/plain',
      sizeBytes: content.length,
    });

    await expect(fileDownloadService.createDownloadUrl(recipient, file.id)).rejects.toMatchObject({
      code: 'entry_not_found',
    });

    const [fileEntry] = await database
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.publicId, file.id));
    if (!fileEntry) {
      throw new Error('Completed file entry is missing');
    }

    const grantCreatedAt = new Date('2020-01-01T00:00:00Z');
    await database.insert(fileGrants).values({
      fileId: fileEntry.id,
      recipientUserId: recipient.id,
      recipientEmail: recipient.email,
      createdByUserId: user.id,
      permission: 'viewer',
      createdAt: grantCreatedAt,
      updatedAt: grantCreatedAt,
    });

    const sharedDownload = await fileDownloadService.createDownloadUrl(recipient, file.id);
    const sharedDownloadResponse = await fetch(sharedDownload.downloadUrl);
    expect(sharedDownloadResponse.status).toBe(200);
    expect(Buffer.from(await sharedDownloadResponse.arrayBuffer())).toStrictEqual(content);

    await database
      .update(fileGrants)
      .set({
        expiresAt: new Date('2021-01-01T00:00:00Z'),
        updatedAt: new Date(),
      })
      .where(eq(fileGrants.fileId, fileEntry.id));
    await expect(fileDownloadService.createDownloadUrl(recipient, file.id)).rejects.toMatchObject({
      code: 'entry_not_found',
    });

    const download = await fileDownloadService.createDownloadUrl(user, file.id);
    const downloadResponse = await fetch(download.downloadUrl);
    expect(downloadResponse.status).toBe(200);
    expect(Buffer.from(await downloadResponse.arrayBuffer())).toStrictEqual(content);

    const [intent] = await database
      .select({ objectKey: uploadIntents.objectKey })
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, presign.uploadId));
    if (!intent) {
      throw new Error('Completed upload intent is missing');
    }

    await entryRepository.deleteEntry({
      actorUserId: user.id,
      entryId: file.id,
    });
    await expect(deletionProcessor.processNext()).resolves.toBe(true);

    const [job] = await database
      .select()
      .from(objectDeletionJobs)
      .where(eq(objectDeletionJobs.objectKey, intent.objectKey));
    expect(job).toMatchObject({
      reason: 'deleted_file',
      attemptCount: 1,
      lastErrorCode: null,
    });
    expect(job?.completedAt).not.toBeNull();
    await expect(storage.getObjectStream(intent.objectKey)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('rejects a presigned PUT whose body length differs from the upload intent', async () => {
    const user = await createUser('content-length-owner');
    const content = Buffer.from('LocalStack exact content length');
    const sha256 = createHash('sha256').update(content).digest('hex');

    const presign = await uploadService.createUpload(user, {
      parentFolderId: null,
      fileName: 'wrong-length.txt',
      contentType: 'text/plain',
      size: content.length + 1,
      sha256,
    });

    expect(new URL(presign.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toContain(
      'content-length',
    );

    const putResponse = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.requiredHeaders,
      body: content,
    });

    expect(putResponse.status).toBe(403);

    const [intent] = await database
      .select({ objectKey: uploadIntents.objectKey })
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, presign.uploadId));
    if (!intent) {
      throw new Error('Pending upload intent is missing');
    }

    await expect(storage.headObject(intent.objectKey)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  async function createUser(userLabel: string): Promise<User> {
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
      throw new Error('Failed to create LocalStack integration test user');
    }

    return user;
  }
});
