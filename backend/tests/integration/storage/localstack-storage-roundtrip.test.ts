import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
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
import { PostgresAuditRepository } from '../../../src/audit/postgres-audit-repository.js';
import { AuthorizationPolicy } from '../../../src/authorization/authorization-policy.js';
import { AuthorizationService } from '../../../src/authorization/authorization-service.js';
import { EntryAccessMapper } from '../../../src/authorization/entry-access-mapper.js';
import { PostgresAuthorizationContextResolver } from '../../../src/authorization/postgres-authorization-context-resolver.js';
import { PostgresEntryAuthorizer } from '../../../src/authorization/postgres-entry-authorizer.js';
import { createDatabase, type Database } from '../../../src/db/db-client.js';
import { DrizzleUnitOfWork } from '../../../src/db/unit-of-work.js';
import { EntryService } from '../../../src/entry/entry-service.js';
import { PostgresEntryRepository } from '../../../src/entry/postgres-entry-repository.js';
import { FileDownloadService } from '../../../src/files/file-download-service.js';
import { PostgresFileRepository } from '../../../src/files/postgres-file-repository.js';
import { StreamingFolderArchiver } from '../../../src/folder/download/streaming-folder-archiver.js';
import { ObjectDeletionProcessor } from '../../../src/object-deletion/object-deletion-processor.js';
import { PostgresObjectDeletionRepository } from '../../../src/object-deletion/postgres-object-deletion-repository.js';
import { StorageInvalidPartsError } from '../../../src/shared/errors/storage/storage-invalid-parts-error.js';
import { StorageObjectNotFoundError } from '../../../src/shared/errors/storage/storage-object-not-found-error.js';
import {
  computeCompositeSha256,
  sha256HexToBase64,
} from '../../../src/shared/utils/sha256-convert.js';
import { S3ObjectStorage } from '../../../src/storage/s3-object-storage.js';
import { PostgresIntentRepository } from '../../../src/upload/postgres-intent-repository.js';
import { UploadService } from '../../../src/upload/upload-service.js';
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
  let fileDownloadService: FileDownloadService;
  let entryService: EntryService;
  let deletionRepository: PostgresObjectDeletionRepository;
  let deletionProcessor: ObjectDeletionProcessor;
  let storage: S3ObjectStorage;
  let localstackEndpoint: string;

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
    localstackEndpoint = endpoint;

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

    const dbHandle = createDatabase({ connectionString: postgres.getConnectionUri() });
    database = dbHandle.db;
    closeDatabase = dbHandle.close;
    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });

    storage = new S3ObjectStorage({
      endpoint,
      publicOrigin: endpoint,
      region: REGION,
      forcePathStyle: true,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      bucket: BUCKET,
    });
    const authorizationContextResolver = new PostgresAuthorizationContextResolver(database);
    const authorizationPolicy = new AuthorizationPolicy();
    const authorizationService = new AuthorizationService(
      authorizationContextResolver,
      authorizationPolicy,
    );
    const unitOfWork = new DrizzleUnitOfWork(database);
    const entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    const auditRepository = new PostgresAuditRepository(database);
    const intentRepository = new PostgresIntentRepository(database);
    uploadService = new UploadService(
      unitOfWork,
      entryAuthorizer,
      storage,
      intentRepository,
      auditRepository,
    );
    fileDownloadService = new FileDownloadService(
      unitOfWork,
      entryAuthorizer,
      new PostgresFileRepository(database),
      auditRepository,
      storage,
    );
    entryService = new EntryService(
      unitOfWork,
      entryAuthorizer,
      new PostgresEntryRepository(database),
      auditRepository,
      new EntryAccessMapper(authorizationPolicy),
    );
    deletionRepository = new PostgresObjectDeletionRepository(database);
    deletionProcessor = new ObjectDeletionProcessor(deletionRepository, storage);
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

    const file = await uploadService.completeUpload(user, presign.uploadId);
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

    await entryService.deleteEntry(user, file.id);
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

  it('signs URLs against publicOrigin while running internal operations against S3_ENDPOINT', async () => {
    const splitStorage = new S3ObjectStorage({
      endpoint: localstackEndpoint,
      publicOrigin: 'https://storage.example.test',
      region: REGION,
      forcePathStyle: true,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      bucket: BUCKET,
    });
    const content = Buffer.from('split endpoint payload');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const objectKey = `split-endpoint/${randomUUID()}.txt`;

    const uploadUrl = await splitStorage.createPresignedUploadUrl({
      objectKey,
      contentType: 'text/plain',
      sizeBytes: content.length,
      expiresInSeconds: 600,
      sha256Hex: sha256,
    });
    const downloadUrl = await splitStorage.createPresignedDownloadUrl({
      objectKey,
      fileName: 'split.txt',
      contentType: 'text/plain',
      expiresInSeconds: 60,
    });

    expect(new URL(uploadUrl).origin).toBe('https://storage.example.test');
    expect(new URL(downloadUrl).origin).toBe('https://storage.example.test');

    await splitStorage.uploadObjectStream({
      objectKey,
      contentType: 'text/plain',
      body: Readable.from([content]),
    });
    await expect(splitStorage.headObject(objectKey)).resolves.toMatchObject({
      objectKey,
      sizeBytes: content.length,
      contentType: 'text/plain',
    });
    await splitStorage.deleteObject(objectKey);
    await expect(splitStorage.headObject(objectKey)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('aborts ZIP upload cleanly in LocalStack when a source object fails mid-archive', async () => {
    const firstKey = `archive-source/${randomUUID()}.txt`;
    const missingKey = `archive-source/${randomUUID()}-missing.txt`;
    const archiveKey = `folder-downloads/${randomUUID()}/1.zip`;

    await storage.uploadObjectStream({
      objectKey: firstKey,
      contentType: 'text/plain',
      body: Readable.from([Buffer.from('first file content')]),
    });

    const archiver = new StreamingFolderArchiver(storage);

    await expect(
      archiver.create({
        archiveObjectKey: archiveKey,
        entries: [
          { kind: 'folder', pathParts: ['Docs'] },
          {
            kind: 'file',
            pathParts: ['Docs', 'first.txt'],
            objectKey: firstKey,
            sizeBytes: 18,
          },
          {
            kind: 'file',
            pathParts: ['Docs', 'missing.txt'],
            objectKey: missingKey,
            sizeBytes: 10,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);

    await expect(storage.headObject(archiveKey)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await storage.deleteObject(firstKey);
  });

  it('completes a multipart upload in LocalStack with per-part SHA-256 and verifies composite checksum', async () => {
    const part1 = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const part2 = Buffer.from('final multipart tail bytes');
    const part1Sha256 = createHash('sha256').update(part1).digest('hex');
    const part2Sha256 = createHash('sha256').update(part2).digest('hex');
    const expectedComposite = computeCompositeSha256([part1Sha256, part2Sha256]);
    const objectKey = `multipart-roundtrip/${randomUUID()}.bin`;

    const s3UploadId = await storage.createMultipartUpload({
      objectKey,
      contentType: 'application/octet-stream',
    });

    const [part1Url, part2Url] = await Promise.all([
      storage.createPresignedUploadPartUrl({
        objectKey,
        s3UploadId,
        partNumber: 1,
        sizeBytes: part1.length,
        expiresInSeconds: 600,
        sha256Hex: part1Sha256,
      }),
      storage.createPresignedUploadPartUrl({
        objectKey,
        s3UploadId,
        partNumber: 2,
        sizeBytes: part2.length,
        expiresInSeconds: 600,
        sha256Hex: part2Sha256,
      }),
    ]);

    const part1Response = await fetch(part1Url, {
      method: 'PUT',
      headers: { 'x-amz-checksum-sha256': sha256HexToBase64(part1Sha256) },
      body: part1,
    });
    expect(part1Response.status, await part1Response.text()).toBe(200);
    const part1Etag = part1Response.headers.get('etag');
    expect(part1Etag).toBeTruthy();

    const part2Response = await fetch(part2Url, {
      method: 'PUT',
      headers: { 'x-amz-checksum-sha256': sha256HexToBase64(part2Sha256) },
      body: part2,
    });
    expect(part2Response.status, await part2Response.text()).toBe(200);
    const part2Etag = part2Response.headers.get('etag');
    expect(part2Etag).toBeTruthy();

    // Completing with a tampered ETag fails with StorageInvalidPartsError
    await expect(
      storage.completeMultipartUpload({
        objectKey,
        s3UploadId,
        parts: [
          { partNumber: 1, etag: '"00000000000000000000000000000000"', sha256Hex: part1Sha256 },
          { partNumber: 2, etag: part2Etag!, sha256Hex: part2Sha256 },
        ],
      }),
    ).rejects.toBeInstanceOf(StorageInvalidPartsError);

    const completion = await storage.completeMultipartUpload({
      objectKey,
      s3UploadId,
      parts: [
        { partNumber: 1, etag: part1Etag!, sha256Hex: part1Sha256 },
        { partNumber: 2, etag: part2Etag!, sha256Hex: part2Sha256 },
      ],
    });
    expect(completion.compositeChecksum).toBe(expectedComposite);

    const head = await storage.headObject(objectKey);
    expect(head).toStrictEqual({
      objectKey,
      sizeBytes: part1.length + part2.length,
      contentType: 'application/octet-stream',
      checksum: {
        type: 'composite_sha256',
        value: expectedComposite,
      },
    });

    await storage.deleteObject(objectKey);
  });

  it('aborts an unfinished multipart upload via ObjectDeletionProcessor and ignores repeated aborts', async () => {
    const objectKey = `multipart-abort/${randomUUID()}.bin`;
    const part1 = Buffer.from('abandoned part payload');
    const part1Sha256 = createHash('sha256').update(part1).digest('hex');

    const s3UploadId = await storage.createMultipartUpload({
      objectKey,
      contentType: 'application/octet-stream',
    });

    const part1Url = await storage.createPresignedUploadPartUrl({
      objectKey,
      s3UploadId,
      partNumber: 1,
      sizeBytes: part1.length,
      expiresInSeconds: 600,
      sha256Hex: part1Sha256,
    });
    const partResponse = await fetch(part1Url, {
      method: 'PUT',
      headers: { 'x-amz-checksum-sha256': sha256HexToBase64(part1Sha256) },
      body: part1,
    });
    expect(partResponse.status, await partResponse.text()).toBe(200);

    await database.insert(objectDeletionJobs).values({
      objectKey,
      s3UploadId,
      reason: 'aborted_upload',
    });

    await expect(deletionProcessor.processNext()).resolves.toBe(true);
    // Repeated abort on already-aborted upload ID is idempotent
    await expect(storage.abortMultipartUpload(objectKey, s3UploadId)).resolves.toBeUndefined();
    await expect(storage.headObject(objectKey)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('uploads, heads, and archives a 0-byte empty file in LocalStack', async () => {
    const emptyContent = Buffer.alloc(0);
    const emptySha256 = createHash('sha256').update(emptyContent).digest('hex');
    const objectKey = `empty-file/${randomUUID()}.txt`;
    const archiveKey = `folder-downloads/${randomUUID()}/empty.zip`;

    const uploadUrl = await storage.createPresignedUploadUrl({
      objectKey,
      contentType: 'text/plain',
      sizeBytes: 0,
      expiresInSeconds: 600,
      sha256Hex: emptySha256,
    });
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': sha256HexToBase64(emptySha256),
      },
      body: emptyContent,
    });
    expect(putResponse.status, await putResponse.text()).toBe(200);

    await expect(storage.headObject(objectKey)).resolves.toStrictEqual({
      objectKey,
      sizeBytes: 0,
      contentType: 'text/plain',
      checksum: {
        type: 'full_sha256',
        value: emptySha256,
      },
    });

    const archiver = new StreamingFolderArchiver(storage);
    const archiveResult = await archiver.create({
      archiveObjectKey: archiveKey,
      entries: [
        { kind: 'folder', pathParts: ['EmptyFolder'] },
        {
          kind: 'file',
          pathParts: ['EmptyFolder', 'empty.txt'],
          objectKey,
          sizeBytes: 0,
        },
      ],
    });
    expect(archiveResult.sizeBytes).toBeGreaterThan(0);

    await storage.deleteObject(objectKey);
    await storage.deleteObject(archiveKey);
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
