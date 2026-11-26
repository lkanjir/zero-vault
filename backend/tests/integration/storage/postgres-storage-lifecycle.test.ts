import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import {
  auditEvents,
  entries,
  fileGrants,
  files,
  folderDownloads,
  objectDeletionJobs,
  uploadIntents,
  users,
} from '../../../src/db/schema.js';
import { PostgresAuditRepository } from '../../../src/audit/postgres-audit-repository.js';
import type { AuditRepository } from '../../../src/audit/audit-repository.js';
import { AuthorizationPolicy } from '../../../src/authorization/authorization-policy.js';
import { AuthorizationService } from '../../../src/authorization/authorization-service.js';
import { EntryAccessMapper } from '../../../src/authorization/entry-access-mapper.js';
import { PostgresAuthorizationContextResolver } from '../../../src/authorization/postgres-authorization-context-resolver.js';
import { PostgresEntryAuthorizer } from '../../../src/authorization/postgres-entry-authorizer.js';
import { createDatabase, type Database } from '../../../src/db/db-client.js';
import { DrizzleUnitOfWork } from '../../../src/db/unit-of-work.js';
import { EntryService } from '../../../src/entry/entry-service.js';
import { PostgresEntryRepository } from '../../../src/entry/postgres-entry-repository.js';
import { resolveParentIdInTransaction } from '../../../src/entry/resolve-parent-id-in-transaction.js';
import { FileDownloadService } from '../../../src/files/file-download-service.js';
import { PostgresFileRepository } from '../../../src/files/postgres-file-repository.js';
import { FolderDownloadService } from '../../../src/folder/download/folder-download-service.js';
import { PostgresFolderDownloadRepository } from '../../../src/folder/download/postgres-folder-download-repository.js';
import { PostgresObjectDeletionRepository } from '../../../src/object-deletion/postgres-object-deletion-repository.js';
import { FileSharingService } from '../../../src/sharing/file-sharing-service.js';
import { PostgresFileGrantRepository } from '../../../src/sharing/postgres-file-grant-repository.js';
import type { ObjectStorage } from '../../../src/storage/object-storage.js';
import { PostgresIntentRepository } from '../../../src/upload/postgres-intent-repository.js';
import type { SaveUploadIntentCommand } from '../../../src/upload/upload-intent-repository.js';
import type { UploadIntentInput } from '../../../src/upload/upload-intent.js';
import { UploadService } from '../../../src/upload/upload-service.js';
import type { User } from '../../../src/user/user.js';

const OWNER_ISSUER = 'https://issuer.example.test/realms/zero-vault';
const SHA256 = 'a'.repeat(64);

describe('PostgreSQL storage lifecycle', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let closeDatabase: () => Promise<void>;
  let folderRepository: PostgresFolderDownloadRepository;
  let deletionRepository: PostgresObjectDeletionRepository;
  let entryRepository: PostgresEntryRepository;
  let entryService: EntryService;
  let intentRepository: PostgresIntentRepository;
  let uploadService: UploadService;
  let unitOfWork: DrizzleUnitOfWork;
  let entryAuthorizer: PostgresEntryAuthorizer;
  let auditRepository: PostgresAuditRepository;
  let fileRepository: PostgresFileRepository;
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
    folderRepository = new PostgresFolderDownloadRepository(database);
    deletionRepository = new PostgresObjectDeletionRepository(database);
    const policy = new AuthorizationPolicy();
    const authorizationService = new AuthorizationService(
      new PostgresAuthorizationContextResolver(database),
      policy,
    );
    const accessMapper = new EntryAccessMapper(policy);
    unitOfWork = new DrizzleUnitOfWork(database);
    entryAuthorizer = new PostgresEntryAuthorizer(authorizationService);
    auditRepository = new PostgresAuditRepository(database);
    fileRepository = new PostgresFileRepository(database);
    entryRepository = new PostgresEntryRepository(database);
    entryService = new EntryService(
      unitOfWork,
      entryAuthorizer,
      entryRepository,
      auditRepository,
      accessMapper,
    );
    sharingService = new FileSharingService(
      unitOfWork,
      authorizationService,
      entryAuthorizer,
      new PostgresFileGrantRepository(database),
      auditRepository,
      accessMapper,
    );
    intentRepository = new PostgresIntentRepository(database);
    uploadService = new UploadService(
      unitOfWork,
      entryAuthorizer,
      createStubStorage(),
      intentRepository,
      auditRepository,
    );

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(auditEvents);
    await database.delete(objectDeletionJobs);
    await database.delete(folderDownloads);
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

  describe('folder archive attempts', () => {
    it('completes an active archive attempt idempotently without enqueueing deletion', async () => {
      const fixture = await createFolderDownload({ status: 'processing', attemptCount: 1 });
      const finishedAt = new Date('2026-07-28T10:00:00.000Z');
      const command = {
        id: fixture.download.id,
        attemptCount: 1,
        archiveObjectKey: `${fixture.baseObjectKey}/1.zip`,
        archiveSizeBytes: 321,
        finishedAt,
        expiresAt: new Date(finishedAt.getTime() + 60 * 60_000),
      };

      await expect(folderRepository.completeArchiveAttempt(command)).resolves.toBe('ready');
      await expect(folderRepository.completeArchiveAttempt(command)).resolves.toBe('ready');

      const [stored] = await database
        .select()
        .from(folderDownloads)
        .where(eq(folderDownloads.id, fixture.download.id));
      const deletionJobs = await database.select().from(objectDeletionJobs);

      expect(stored).toMatchObject({
        status: 'ready',
        attemptCount: 1,
        archiveObjectKey: command.archiveObjectKey,
        archiveSizeBytes: command.archiveSizeBytes,
        finishedAt,
        expiresAt: command.expiresAt,
        leaseExpiresAt: null,
        failureCode: null,
      });
      expect(deletionJobs).toHaveLength(0);
    });

    it('queues an archive produced by a stale attempt without changing the active attempt', async () => {
      const fixture = await createFolderDownload({ status: 'processing', attemptCount: 2 });
      const staleObjectKey = `${fixture.baseObjectKey}/1.zip`;

      await expect(
        folderRepository.completeArchiveAttempt({
          id: fixture.download.id,
          attemptCount: 1,
          archiveObjectKey: staleObjectKey,
          archiveSizeBytes: 321,
          finishedAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        }),
      ).resolves.toBe('stale');

      const [stored] = await database
        .select()
        .from(folderDownloads)
        .where(eq(folderDownloads.id, fixture.download.id));
      const [deletionJob] = await database
        .select()
        .from(objectDeletionJobs)
        .where(eq(objectDeletionJobs.objectKey, staleObjectKey));

      expect(stored).toMatchObject({
        status: 'processing',
        attemptCount: 2,
        archiveObjectKey: fixture.baseObjectKey,
      });
      expect(deletionJob).toMatchObject({
        objectKey: staleObjectKey,
        reason: 'stale_folder_archive_attempt',
        attemptCount: 0,
        completedAt: null,
      });
    });

    it('expires only due ready archives in stable batches and queues each object once', async () => {
      const now = new Date('2026-07-28T10:00:00.000Z');
      const first = await createFolderDownload({
        status: 'ready',
        expiresAt: new Date(now.getTime() - 120_000),
      });
      const second = await createFolderDownload({
        status: 'ready',
        expiresAt: new Date(now.getTime() - 60_000),
      });
      const future = await createFolderDownload({
        status: 'ready',
        expiresAt: new Date(now.getTime() + 60_000),
      });

      await expect(
        folderRepository.expireReadyFolderDownloads({ expiredAt: now, limit: 1 }),
      ).resolves.toBe(1);

      let storedDownloads = await database
        .select({
          id: folderDownloads.id,
          status: folderDownloads.status,
        })
        .from(folderDownloads)
        .orderBy(asc(folderDownloads.id));
      let jobs = await database
        .select()
        .from(objectDeletionJobs)
        .orderBy(asc(objectDeletionJobs.id));

      expect(storedDownloads.find((download) => download.id === first.download.id)?.status).toBe(
        'expired',
      );
      expect(storedDownloads.find((download) => download.id === second.download.id)?.status).toBe(
        'ready',
      );
      expect(jobs.map((job) => [job.objectKey, job.reason])).toStrictEqual([
        [first.archiveObjectKey, 'expired_folder_archive'],
      ]);

      await expect(
        folderRepository.expireReadyFolderDownloads({ expiredAt: now, limit: 100 }),
      ).resolves.toBe(1);
      await expect(
        folderRepository.expireReadyFolderDownloads({ expiredAt: now, limit: 100 }),
      ).resolves.toBe(0);

      storedDownloads = await database
        .select({
          id: folderDownloads.id,
          status: folderDownloads.status,
        })
        .from(folderDownloads);
      jobs = await database.select().from(objectDeletionJobs);

      expect(storedDownloads.find((download) => download.id === second.download.id)?.status).toBe(
        'expired',
      );
      expect(storedDownloads.find((download) => download.id === future.download.id)?.status).toBe(
        'ready',
      );
      expect(jobs).toHaveLength(2);
    });

    it('claims queued work and only reclaims processing work after its lease expires', async () => {
      const now = new Date('2026-07-28T10:00:00.000Z');
      const fixture = await createFolderDownload({ status: 'queued', attemptCount: 0 });

      const firstClaim = await folderRepository.claimNext({
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        maxAttempts: 3,
      });
      const whileLeased = await folderRepository.claimNext({
        claimedAt: new Date(now.getTime() + 30_000),
        leaseExpiresAt: new Date(now.getTime() + 90_000),
        maxAttempts: 3,
      });
      const reclaimed = await folderRepository.claimNext({
        claimedAt: new Date(now.getTime() + 60_000),
        leaseExpiresAt: new Date(now.getTime() + 120_000),
        maxAttempts: 3,
      });

      expect(firstClaim).toMatchObject({
        id: fixture.download.id,
        status: 'processing',
        attemptCount: 1,
      });
      expect(whileLeased).toBeNull();
      expect(reclaimed).toMatchObject({
        id: fixture.download.id,
        status: 'processing',
        attemptCount: 2,
      });
    });

    it('fails expired processing downloads that reached maxAttempts and unblocks subsequent queued work', async () => {
      const now = new Date('2026-07-28T10:00:00.000Z');
      const exhausted = await createFolderDownload({ status: 'processing', attemptCount: 3 });
      await database
        .update(folderDownloads)
        .set({ leaseExpiresAt: new Date(now.getTime() - 1_000) })
        .where(eq(folderDownloads.id, exhausted.download.id));
      const nextQueued = await createFolderDownload({ status: 'queued', attemptCount: 0 });

      const claimed = await folderRepository.claimNext({
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        maxAttempts: 3,
      });

      expect(claimed).toMatchObject({
        id: nextQueued.download.id,
        status: 'processing',
        attemptCount: 1,
      });

      const [storedExhausted] = await database
        .select()
        .from(folderDownloads)
        .where(eq(folderDownloads.id, exhausted.download.id));

      expect(storedExhausted).toMatchObject({
        status: 'failed',
        attemptCount: 3,
        failureCode: 'max_attempts_exceeded',
        finishedAt: now,
        leaseExpiresAt: null,
      });
    });

    it('builds a recursive owner-scoped archive manifest', async () => {
      const owner = await createUser();
      const root = await createFolder(owner.id, 'Root');
      const nested = await createFolder(owner.id, 'Nested', root.id);
      await createFile(owner.id, root.id, 'root.txt', 'objects/root');
      await createFile(owner.id, nested.id, 'nested.txt', 'objects/nested');

      await expect(
        folderRepository.getArchiveManifest({
          ownerId: owner.id,
          rootFolderId: root.id,
          rootFolderName: root.name,
        }),
      ).resolves.toStrictEqual([
        { kind: 'folder', pathParts: ['Root'] },
        { kind: 'folder', pathParts: ['Root', 'Nested'] },
        {
          kind: 'file',
          pathParts: ['Root', 'Nested', 'nested.txt'],
          objectKey: 'objects/nested',
          sizeBytes: 12,
        },
        {
          kind: 'file',
          pathParts: ['Root', 'root.txt'],
          objectKey: 'objects/root',
          sizeBytes: 12,
        },
      ]);
    });
  });

  describe('object deletion jobs', () => {
    it('claims only due work and fences stale reschedule and completion attempts', async () => {
      const now = new Date('2026-07-28T10:00:00.000Z');
      const [due] = await database
        .insert(objectDeletionJobs)
        .values({
          objectKey: 'objects/due',
          reason: 'deleted_file',
          availableAt: now,
        })
        .returning();
      await database.insert(objectDeletionJobs).values({
        objectKey: 'objects/future',
        reason: 'expired_upload',
        availableAt: new Date(now.getTime() + 60_000),
      });

      if (!due) {
        throw new Error('Failed to create due deletion job');
      }

      const firstClaim = await deletionRepository.claimNext({
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 30_000),
        maxAttempts: 10,
      });

      expect(firstClaim).toMatchObject({
        id: due.id,
        objectKey: due.objectKey,
        attemptCount: 1,
      });
      await expect(
        deletionRepository.reschedule({
          id: due.id,
          attemptCount: 0,
          availableAt: new Date(now.getTime() + 60_000),
          errorCode: 'stale',
        }),
      ).resolves.toBe(false);
      await expect(
        deletionRepository.reschedule({
          id: due.id,
          attemptCount: 1,
          availableAt: new Date(now.getTime() + 60_000),
          errorCode: 'storage_unavailable',
        }),
      ).resolves.toBe(true);
      await expect(
        deletionRepository.claimNext({
          claimedAt: new Date(now.getTime() + 30_000),
          leaseExpiresAt: new Date(now.getTime() + 90_000),
          maxAttempts: 10,
        }),
      ).resolves.toBeNull();

      const secondClaim = await deletionRepository.claimNext({
        claimedAt: new Date(now.getTime() + 60_000),
        leaseExpiresAt: new Date(now.getTime() + 90_000),
        maxAttempts: 10,
      });

      expect(secondClaim).toMatchObject({
        id: due.id,
        attemptCount: 2,
        lastErrorCode: 'storage_unavailable',
      });
      await expect(
        deletionRepository.complete({
          id: due.id,
          attemptCount: 1,
          completedAt: new Date(now.getTime() + 61_000),
        }),
      ).resolves.toBe(false);
      await expect(
        deletionRepository.complete({
          id: due.id,
          attemptCount: 2,
          completedAt: new Date(now.getTime() + 61_000),
        }),
      ).resolves.toBe(true);

      const [completed] = await database
        .select()
        .from(objectDeletionJobs)
        .where(eq(objectDeletionJobs.id, due.id));

      expect(completed).toMatchObject({
        attemptCount: 2,
        leaseExpiresAt: null,
        lastErrorCode: null,
        failedAt: null,
      });
      expect(completed?.completedAt).not.toBeNull();
    });

    it('marks exhausted deletion jobs terminally failed and unblocks subsequent jobs', async () => {
      const now = new Date('2026-07-28T10:00:00.000Z');
      const [exhausted] = await database
        .insert(objectDeletionJobs)
        .values({
          objectKey: 'objects/poison-pill',
          reason: 'deleted_file',
          availableAt: new Date(now.getTime() - 60_000),
          attemptCount: 10,
          leaseExpiresAt: new Date(now.getTime() - 1_000),
        })
        .returning();
      const [nextDue] = await database
        .insert(objectDeletionJobs)
        .values({
          objectKey: 'objects/healthy',
          reason: 'expired_upload',
          availableAt: now,
        })
        .returning();

      if (!exhausted || !nextDue) {
        throw new Error('Failed to seed object deletion jobs');
      }

      const claimed = await deletionRepository.claimNext({
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        maxAttempts: 10,
      });

      expect(claimed).toMatchObject({
        id: nextDue.id,
        objectKey: 'objects/healthy',
        attemptCount: 1,
        failedAt: null,
      });

      const [storedExhausted] = await database
        .select()
        .from(objectDeletionJobs)
        .where(eq(objectDeletionJobs.id, exhausted.id));

      expect(storedExhausted).toMatchObject({
        attemptCount: 10,
        completedAt: null,
        failedAt: now,
        leaseExpiresAt: null,
        lastErrorCode: 'max_attempts_exceeded',
      });

      await expect(
        deletionRepository.markFailed({
          id: nextDue.id,
          attemptCount: 0,
          failedAt: now,
          errorCode: 'stale',
        }),
      ).resolves.toBe(false);
      await expect(
        deletionRepository.markFailed({
          id: nextDue.id,
          attemptCount: 1,
          failedAt: now,
          errorCode: 'storage_unavailable',
        }),
      ).resolves.toBe(true);

      await expect(
        deletionRepository.claimNext({
          claimedAt: new Date(now.getTime() + 120_000),
          leaseExpiresAt: new Date(now.getTime() + 180_000),
          maxAttempts: 10,
        }),
      ).resolves.toBeNull();
    });
  });

  describe('entry deletion', () => {
    it('soft-deletes file metadata and atomically queues its storage object', async () => {
      const owner = await createUser();
      const file = await createFile(owner.id, null, 'report.txt', 'objects/report');
      const startedAt = new Date();

      await entryService.deleteEntry(toDomainUser(owner), file.publicId);
      const finishedAt = new Date();

      const [storedEntry] = await database.select().from(entries).where(eq(entries.id, file.id));
      const [job] = await database
        .select()
        .from(objectDeletionJobs)
        .where(eq(objectDeletionJobs.objectKey, 'objects/report'));

      expect(storedEntry?.deletedAt).not.toBeNull();
      expect(storedEntry?.updatedAt).toEqual(storedEntry?.deletedAt);
      expect(storedEntry!.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
      expect(storedEntry!.updatedAt.getTime()).toBeLessThanOrEqual(finishedAt.getTime());
      expect(job).toMatchObject({
        reason: 'deleted_file',
        objectKey: 'objects/report',
        completedAt: null,
      });
    });

    it('deletes an empty folder but rejects a non-empty folder without partial changes', async () => {
      const owner = await createUser();
      const empty = await createFolder(owner.id, 'Empty');
      const nonEmpty = await createFolder(owner.id, 'Non-empty');
      await createFolder(owner.id, 'Child', nonEmpty.id);

      await expect(
        entryService.deleteEntry(toDomainUser(owner), empty.publicId),
      ).resolves.toBeUndefined();
      await expect(
        entryService.deleteEntry(toDomainUser(owner), nonEmpty.publicId),
      ).rejects.toMatchObject({
        code: 'folder_not_empty',
      });

      const [storedEmpty] = await database.select().from(entries).where(eq(entries.id, empty.id));
      const [storedNonEmpty] = await database
        .select()
        .from(entries)
        .where(eq(entries.id, nonEmpty.id));

      expect(storedEmpty?.deletedAt).not.toBeNull();
      expect(storedNonEmpty?.deletedAt).toBeNull();
      expect(await database.select().from(objectDeletionJobs)).toHaveLength(0);
    });

    it('waits for an active parent key-share lock before deleting the folder', async () => {
      const owner = await createUser();
      const folder = await createFolder(owner.id, 'Locked parent');
      let releaseLock!: () => void;
      let reportLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        reportLocked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      const parentTransaction = database.transaction(async (tx) => {
        await resolveParentIdInTransaction(tx, owner.id, folder.publicId);
        reportLocked();
        await release;
      });
      await locked;

      const deletion = entryService.deleteEntry(toDomainUser(owner), folder.publicId);
      const earlyResult = await Promise.race([
        deletion.then(() => 'deleted' as const),
        delay(100).then(() => 'waiting' as const),
      ]);

      try {
        expect(earlyResult).toBe('waiting');
      } finally {
        releaseLock();
        await parentTransaction;
      }
      await expect(deletion).resolves.toBeUndefined();
    });
  });

  describe('upload expiry', () => {
    it('expires due pending intents in batches and queues their objects', async () => {
      const owner = await createUser();
      const now = new Date('2026-07-28T10:00:00.000Z');
      const due = makeIntent(owner.id, {
        createdAt: new Date(now.getTime() - 180_000),
        uploadUrlExpiresAt: new Date(now.getTime() - 120_000),
        finalizeDeadline: new Date(now.getTime() - 60_000),
      });
      const future = makeIntent(owner.id, {
        createdAt: now,
        uploadUrlExpiresAt: new Date(now.getTime() + 60_000),
        finalizeDeadline: new Date(now.getTime() + 120_000),
      });
      await unitOfWork.run((tx) => intentRepository.save(due, tx));
      await unitOfWork.run((tx) => intentRepository.save(future, tx));

      await expect(
        intentRepository.expirePendingIntents({ expiredAt: now, limit: 100 }),
      ).resolves.toBe(1);

      const storedIntents = await database
        .select()
        .from(uploadIntents)
        .orderBy(asc(uploadIntents.id));
      const jobs = await database.select().from(objectDeletionJobs);

      expect(storedIntents.map((intent) => intent.status)).toStrictEqual(['expired', 'pending']);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        objectKey: due.upload.objectKey,
        reason: 'expired_upload',
      });
    });

    it('queues cleanup when an upload expires during completion', async () => {
      const owner = await createUser();
      const now = new Date();
      const intent = makeIntent(owner.id, {
        createdAt: new Date(now.getTime() - 180_000),
        uploadUrlExpiresAt: new Date(now.getTime() - 120_000),
        finalizeDeadline: new Date(now.getTime() - 60_000),
      });
      await unitOfWork.run((tx) => intentRepository.save(intent, tx));

      await expect(
        uploadService.completeUpload(toDomainUser(owner), intent.upload.uploadId),
      ).rejects.toMatchObject({ code: 'upload_expired' });

      const [storedIntent] = await database
        .select()
        .from(uploadIntents)
        .where(eq(uploadIntents.uploadId, intent.upload.uploadId));
      const [job] = await database
        .select()
        .from(objectDeletionJobs)
        .where(eq(objectDeletionJobs.objectKey, intent.upload.objectKey));

      expect(storedIntent?.status).toBe('expired');
      expect(job).toMatchObject({
        objectKey: intent.upload.objectKey,
        reason: 'expired_upload',
      });
    });
  });

  describe('entry listing', () => {
    it('returns the complete folder path and folder-first child ordering', async () => {
      const owner = await createUser();
      const root = await createFolder(owner.id, 'Root');
      const current = await createFolder(owner.id, 'Current', root.id);
      const file = await createFile(owner.id, current.id, 'A file.txt', 'objects/file');
      const child = await createFolder(owner.id, 'Z folder', current.id);

      const listing = await entryRepository.getEntries({
        ownerId: owner.id,
        parentId: current.publicId,
        cursor: null,
        limit: 50,
        search: null,
        kind: null,
        sort: 'name-asc',
      });

      expect(listing.path).toStrictEqual([
        { id: root.publicId, name: root.name },
        { id: current.publicId, name: current.name },
      ]);
      expect(listing.entries.map((record) => record.entry.id)).toStrictEqual([
        child.publicId,
        file.publicId,
      ]);
      expect(listing.entries.map((record) => record.entry.kind)).toStrictEqual(['folder', 'file']);
    });

    it('searches names case-insensitively as literal text and filters by kind', async () => {
      const owner = await createUser();
      const matchingFile = await createFile(owner.id, null, 'Q1_100%.txt', 'objects/matching');
      const matchingFolder = await createFolder(owner.id, 'Q1_100% archive');
      await createFile(owner.id, null, 'Q1A100-final.txt', 'objects/wildcard-decoy');

      const allMatches = await entryRepository.getEntries({
        ownerId: owner.id,
        parentId: null,
        cursor: null,
        limit: 50,
        search: 'q1_100%',
        kind: null,
        sort: 'name-asc',
      });
      const fileMatches = await entryRepository.getEntries({
        ownerId: owner.id,
        parentId: null,
        cursor: null,
        limit: 50,
        search: 'q1_100%',
        kind: 'file',
        sort: 'name-asc',
      });
      const folderMatches = await entryRepository.getEntries({
        ownerId: owner.id,
        parentId: null,
        cursor: null,
        limit: 50,
        search: 'q1_100%',
        kind: 'folder',
        sort: 'name-asc',
      });

      expect(allMatches.entries.map((record) => record.entry.id)).toStrictEqual([
        matchingFolder.publicId,
        matchingFile.publicId,
      ]);
      expect(fileMatches.entries.map((record) => record.entry.id)).toStrictEqual([
        matchingFile.publicId,
      ]);
      expect(folderMatches.entries.map((record) => record.entry.id)).toStrictEqual([
        matchingFolder.publicId,
      ]);
    });

    it.each([
      ['name-asc', ['Alpha.txt', 'bravo.txt', 'Charlie.txt', 'delta.txt']],
      ['name-desc', ['delta.txt', 'Charlie.txt', 'bravo.txt', 'Alpha.txt']],
      ['updated-asc', ['delta.txt', 'Charlie.txt', 'Alpha.txt', 'bravo.txt']],
      ['updated-desc', ['bravo.txt', 'Alpha.txt', 'Charlie.txt', 'delta.txt']],
    ] as const)(
      'paginates without gaps or duplicates using %s ordering',
      async (sort, expected) => {
        const owner = await createUser();
        const delta = await createFile(owner.id, null, 'delta.txt', 'objects/delta');
        const alpha = await createFile(owner.id, null, 'Alpha.txt', 'objects/alpha');
        const charlie = await createFile(owner.id, null, 'Charlie.txt', 'objects/charlie');
        const bravo = await createFile(owner.id, null, 'bravo.txt', 'objects/bravo');

        const oldest = new Date('2026-07-28T10:00:00.100Z');
        const middle = new Date('2026-07-28T10:01:00.200Z');
        const newest = new Date('2026-07-28T10:02:00.300Z');

        await database.update(entries).set({ updatedAt: oldest }).where(eq(entries.id, delta.id));
        await database.update(entries).set({ updatedAt: newest }).where(eq(entries.id, alpha.id));
        await database.update(entries).set({ updatedAt: middle }).where(eq(entries.id, charlie.id));
        await database.update(entries).set({ updatedAt: newest }).where(eq(entries.id, bravo.id));

        const firstPage = await entryRepository.getEntries({
          ownerId: owner.id,
          parentId: null,
          cursor: null,
          limit: 2,
          search: null,
          kind: 'file',
          sort,
        });
        const lastFirstPageEntry = firstPage.entries.at(-1);

        if (!lastFirstPageEntry) {
          throw new Error('Expected the first listing page to contain entries');
        }

        const secondPage = await entryRepository.getEntries({
          ownerId: owner.id,
          parentId: null,
          cursor: {
            v: 2,
            parentId: null,
            search: null,
            kind: 'file',
            sort,
            ...lastFirstPageEntry.cursor,
          },
          limit: 2,
          search: null,
          kind: 'file',
          sort,
        });

        const names = [...firstPage.entries, ...secondPage.entries].map(
          (record) => record.entry.name,
        );

        expect(names).toStrictEqual(expected);
        expect(new Set(names).size).toBe(expected.length);
      },
    );

    it('creates all expected listing, search, and partial unique indexes via migrations', async () => {
      const result = await database.execute<{ indexname: string }>(sql`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
      `);

      const indexNames = new Set(result.rows.map((row) => row.indexname));

      expect(indexNames).toContain('entries_owner_parent_name_active_key');
      expect(indexNames).toContain('entries_owner_parent_listing_index');
      expect(indexNames).toContain('entries_owner_parent_updated_at_listing_idx');
      expect(indexNames).toContain('entries_name_trgm_idx');
      expect(indexNames).toContain('users_active_email_key');
      expect(indexNames).toContain('file_grants_file_recipient_user_key');
      expect(indexNames).toContain('audit_events_entry_name_snapshot_trgm_idx');
    });
  });

  describe('download transactional consistency', () => {
    it('commits folder download creation and audit event atomically', async () => {
      const owner = await createUser();
      const folder = await createFolder(owner.id, 'Reports');
      const service = new FolderDownloadService(
        unitOfWork,
        entryAuthorizer,
        folderRepository,
        auditRepository,
        createStubStorage(),
      );

      const response = await service.createDownload(toDomainUser(owner), folder.publicId);

      const downloads = await database.select().from(folderDownloads);
      const events = await database.select().from(auditEvents);

      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toMatchObject({
        downloadId: response.downloadId,
        folderId: folder.id,
        folderName: 'Reports',
        status: 'queued',
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        ownerId: owner.id,
        actorUserId: owner.id,
        entryId: folder.id,
        action: 'folder.archive_requested',
      });
    });

    it('rolls back folder download creation when audit recording fails', async () => {
      const owner = await createUser();
      const folder = await createFolder(owner.id, 'Reports');
      const failingAuditRepo: AuditRepository = {
        record: () => Promise.reject(new Error('audit write failed')),
        listEvents: () => Promise.resolve([]),
        getStatistics: () =>
          Promise.resolve({ total: 0, entryChanges: 0, downloadRequests: 0, sharingChanges: 0 }),
      };
      const service = new FolderDownloadService(
        unitOfWork,
        entryAuthorizer,
        folderRepository,
        failingAuditRepo,
        createStubStorage(),
      );

      await expect(service.createDownload(toDomainUser(owner), folder.publicId)).rejects.toThrow(
        'audit write failed',
      );

      expect(await database.select().from(folderDownloads)).toHaveLength(0);
      expect(await database.select().from(auditEvents)).toHaveLength(0);
    });

    it('blocks concurrent deletion while a file download transaction holds the entry share lock', async () => {
      const owner = await createUser();
      const file = await createFile(owner.id, null, 'locked.txt', 'objects/locked');
      let releaseSign!: () => void;
      let reportSigning!: () => void;
      const signingStarted = new Promise<void>((resolve) => {
        reportSigning = resolve;
      });
      const allowSigningToFinish = new Promise<void>((resolve) => {
        releaseSign = resolve;
      });

      const blockingStorage: ObjectStorage = {
        ...createStubStorage(),
        createPresignedDownloadUrl: async () => {
          reportSigning();
          await allowSigningToFinish;
          return 'https://storage.example.test/download';
        },
      };
      const service = new FileDownloadService(
        unitOfWork,
        entryAuthorizer,
        fileRepository,
        auditRepository,
        blockingStorage,
      );

      const downloadPromise = service.createDownloadUrl(toDomainUser(owner), file.publicId);
      await signingStarted;

      const deletePromise = entryService.deleteEntry(toDomainUser(owner), file.publicId);

      const raceResult = await Promise.race([
        deletePromise.then(() => 'deleted' as const),
        delay(100).then(() => 'waiting' as const),
      ]);

      try {
        expect(raceResult).toBe('waiting');
      } finally {
        releaseSign();
      }

      await expect(downloadPromise).resolves.toMatchObject({
        fileId: file.publicId,
        downloadUrl: 'https://storage.example.test/download',
      });
      await expect(deletePromise).resolves.toBeUndefined();

      const events = await database.select().from(auditEvents).orderBy(asc(auditEvents.id));
      expect(events.map((event) => event.action)).toStrictEqual([
        'file.download_url_issued',
        'entry.deleted',
      ]);
    });

    it('rejects file download without persisting audit when audit recording fails', async () => {
      const owner = await createUser();
      const file = await createFile(owner.id, null, 'audit-fail.txt', 'objects/audit-fail');
      const failingAuditRepo: AuditRepository = {
        record: () => Promise.reject(new Error('audit write failed')),
        listEvents: () => Promise.resolve([]),
        getStatistics: () =>
          Promise.resolve({ total: 0, entryChanges: 0, downloadRequests: 0, sharingChanges: 0 }),
      };
      const service = new FileDownloadService(
        unitOfWork,
        entryAuthorizer,
        fileRepository,
        failingAuditRepo,
        createStubStorage(),
      );

      await expect(service.createDownloadUrl(toDomainUser(owner), file.publicId)).rejects.toThrow(
        'audit write failed',
      );
      expect(await database.select().from(auditEvents)).toHaveLength(0);
    });

    it('serializes shared file download with concurrent share revocation without deadlock and denies subsequent download', async () => {
      const owner = await createUser();
      const viewer = await createUser();
      const file = await createFile(owner.id, null, 'shared-locked.txt', 'objects/shared-locked');
      const [grant] = await database
        .insert(fileGrants)
        .values({
          fileId: file.id,
          recipientUserId: viewer.id,
          recipientEmail: viewer.email,
          createdByUserId: owner.id,
          permission: 'viewer',
        })
        .returning({ publicId: fileGrants.publicId });

      if (!grant) {
        throw new Error('Failed to create test file grant');
      }

      let releaseSign!: () => void;
      let reportSigning!: () => void;
      const signingStarted = new Promise<void>((resolve) => {
        reportSigning = resolve;
      });
      const allowSigningToFinish = new Promise<void>((resolve) => {
        releaseSign = resolve;
      });

      const blockingStorage: ObjectStorage = {
        ...createStubStorage(),
        createPresignedDownloadUrl: async () => {
          reportSigning();
          await allowSigningToFinish;
          return 'https://storage.example.test/shared-download';
        },
      };
      const downloadService = new FileDownloadService(
        unitOfWork,
        entryAuthorizer,
        fileRepository,
        auditRepository,
        blockingStorage,
      );

      const downloadPromise = downloadService.createDownloadUrl(
        toDomainUser(viewer),
        file.publicId,
      );
      await signingStarted;

      const revokePromise = sharingService.revokeFileShare(
        toDomainUser(owner),
        file.publicId,
        grant.publicId,
      );

      const raceResult = await Promise.race([
        revokePromise.then(() => 'revoked' as const),
        delay(100).then(() => 'waiting' as const),
      ]);

      try {
        expect(raceResult).toBe('waiting');
      } finally {
        releaseSign();
      }

      await expect(downloadPromise).resolves.toMatchObject({
        fileId: file.publicId,
        downloadUrl: 'https://storage.example.test/shared-download',
      });
      await expect(revokePromise).resolves.toBeUndefined();

      const immediateDownloadService = new FileDownloadService(
        unitOfWork,
        entryAuthorizer,
        fileRepository,
        auditRepository,
        createStubStorage(),
      );
      await expect(
        immediateDownloadService.createDownloadUrl(toDomainUser(viewer), file.publicId),
      ).rejects.toMatchObject({ code: 'entry_not_found' });

      const events = await database.select().from(auditEvents).orderBy(asc(auditEvents.id));
      expect(events.map((event) => event.action)).toStrictEqual([
        'file.download_url_issued',
        'file.share_revoked',
      ]);
    });
  });

  async function createUser() {
    const [user] = await database
      .insert(users)
      .values({
        issuer: OWNER_ISSUER,
        subject: randomUUID(),
        email: `${randomUUID()}@example.com`,
        firstName: 'Test',
        lastName: 'User',
      })
      .returning({ id: users.id, publicId: users.publicId, email: users.email });

    if (!user) {
      throw new Error('Failed to create integration test user');
    }

    return user;
  }

  async function createFolder(ownerId: number, name: string, parentId: number | null = null) {
    const [folder] = await database
      .insert(entries)
      .values({
        ownerId,
        parentId,
        kind: 'folder',
        name,
      })
      .returning();

    if (!folder) {
      throw new Error('Failed to create integration test folder');
    }

    return folder;
  }

  async function createFile(
    ownerId: number,
    parentId: number | null,
    name: string,
    objectKey: string,
  ) {
    const [entry] = await database
      .insert(entries)
      .values({
        ownerId,
        parentId,
        kind: 'file',
        name,
      })
      .returning();

    if (!entry) {
      throw new Error('Failed to create integration test file entry');
    }

    await database.insert(files).values({
      entryId: entry.id,
      objectKey,
      contentType: 'text/plain',
      sizeBytes: 12,
      sha256: SHA256,
    });

    return entry;
  }

  async function createFolderDownload(options: {
    status: 'queued' | 'processing' | 'ready';
    attemptCount?: number;
    expiresAt?: Date;
  }) {
    const owner = await createUser();
    const folder = await createFolder(owner.id, 'Documents');
    const downloadId = randomUUID();
    const baseObjectKey = `folder-downloads/${owner.publicId}/${downloadId}`;
    const archiveObjectKey =
      options.status === 'ready'
        ? `${baseObjectKey}/${options.attemptCount ?? 1}.zip`
        : baseObjectKey;
    const now = new Date('2026-07-28T09:00:00.000Z');
    const [download] = await database
      .insert(folderDownloads)
      .values({
        downloadId,
        ownerId: owner.id,
        folderId: folder.id,
        folderName: folder.name,
        archiveObjectKey,
        status: options.status,
        attemptCount: options.attemptCount ?? (options.status === 'queued' ? 0 : 1),
        archiveSizeBytes: options.status === 'ready' ? 321 : null,
        createdAt: now,
        startedAt: options.status === 'queued' ? null : now,
        finishedAt: options.status === 'ready' ? now : null,
        leaseExpiresAt: options.status === 'processing' ? new Date(now.getTime() + 60_000) : null,
        expiresAt: options.expiresAt ?? null,
      })
      .returning();

    if (!download) {
      throw new Error('Failed to create integration test folder download');
    }

    return {
      owner,
      folder,
      download,
      baseObjectKey,
      archiveObjectKey,
    };
  }
});

function toDomainUser(user: { id: number; publicId: string; email?: string }): User {
  const now = new Date('2026-07-28T10:00:00.000Z');
  return {
    id: user.id,
    publicId: user.publicId,
    issuer: OWNER_ISSUER,
    subject: 'test-subject',
    email: user.email ?? 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function createStubStorage(): ObjectStorage {
  return {
    createPresignedUploadUrl: () => Promise.resolve('https://storage.example.test/upload'),
    createPresignedDownloadUrl: () => Promise.resolve('https://storage.example.test/download'),
    headObject: () => Promise.reject(new Error('not implemented')),
    deleteObject: () => Promise.resolve(),
    getObjectStream: () => Promise.reject(new Error('not implemented')),
    uploadObjectStream: () => Promise.resolve(),
  };
}

function makeIntent(
  userId: number,
  overrides: Partial<UploadIntentInput> = {},
): SaveUploadIntentCommand {
  const createdAt = new Date('2026-07-28T09:00:00.000Z');

  return {
    targetParentId: null,
    fileName: `${randomUUID()}.txt`,
    upload: {
      uploadId: randomUUID(),
      createdByUserId: userId,
      objectKey: `integration-tests/${randomUUID()}`,
      contentType: 'text/plain',
      expectedSizeBytes: 12,
      expectedSha256: SHA256,
      createdAt,
      uploadUrlExpiresAt: new Date(createdAt.getTime() + 60_000),
      finalizeDeadline: new Date(createdAt.getTime() + 120_000),
      ...overrides,
    },
  };
}
