import { FileDownloadService } from './files/file-download-service.js';
import { EntryService } from './entry/entry-service.js';
import { PostgresEntryRepository } from './entry/postgres-entry-repository.js';
import { PostgresFileRepository } from './files/postgres-file-repository.js';
import { S3ObjectStorage } from './storage/s3-object-storage.js';
import { PostgresIntentRepository } from './upload/postgres-intent-repository.js';
import { UploadService } from './upload/upload-service.js';
import { PostgresUserRepository } from './user/postgres-user-repository.js';
import { UserService } from './user/user-service.js';
import { UploadCleanupService } from './upload/upload-cleanup-service.js';
import { FolderDownloadService } from './folder/download/folder-download-service.js';
import { PostgresFolderDownloadRepository } from './folder/download/postgres-folder-download-repository.js';
import { StreamingFolderArchiver } from './folder/download/streaming-folder-archiver.js';
import { FolderDownloadProcessor } from './folder/download/folder-download-processor.js';
import { PostgresObjectDeletionRepository } from './object-deletion/postgres-object-deletion-repository.js';
import { ObjectDeletionProcessor } from './object-deletion/object-deletion-processor.js';
import { FolderDownloadCleanupService } from './folder/download/folder-download-cleanup-service.js';
import { PostgresAuthorizationContextResolver } from './authorization/postgres-authorization-context-resolver.js';
import { AuthorizationPolicy } from './authorization/authorization-policy.js';
import { AuthorizationService } from './authorization/authorization-service.js';
import { EntryAccessMapper } from './authorization/entry-access-mapper.js';
import { PostgresEntryAuthorizer } from './authorization/postgres-entry-authorizer.js';
import { PostgresFileGrantRepository } from './sharing/postgres-file-grant-repository.js';
import { FileSharingService } from './sharing/file-sharing-service.js';
import { FileGrantMaintenanceService } from './sharing/file-grant-maintenance-service.js';
import { PostgresAuditRepository } from './audit/postgres-audit-repository.js';
import { AuditService } from './audit/audit-service.js';
import type { S3Config } from './config.js';
import type { Database } from './db/db-client.js';
import { DrizzleUnitOfWork } from './db/unit-of-work.js';

function createAuthorizationPrimitives(db: Database) {
  const authorizationContextResolver = new PostgresAuthorizationContextResolver(db);
  const authorizationPolicy = new AuthorizationPolicy();
  const authorizationService = new AuthorizationService(
    authorizationContextResolver,
    authorizationPolicy,
  );
  const authzMapper = new EntryAccessMapper(authorizationPolicy);
  const authorizer = new PostgresEntryAuthorizer(authorizationService);

  return {
    authorizationService,
    authzMapper,
    authorizer,
  };
}

export function createApiComposition(db: Database, s3Config: S3Config) {
  const unitOfWork = new DrizzleUnitOfWork(db);
  const { authorizationService, authzMapper, authorizer } = createAuthorizationPrimitives(db);
  const storage = new S3ObjectStorage(s3Config);

  const auditRepository = new PostgresAuditRepository(db);
  const auditService = new AuditService(authorizationService, auditRepository);

  const userRepository = new PostgresUserRepository(db);
  const userService = new UserService(userRepository);

  const intentRepository = new PostgresIntentRepository(db);
  const uploadService = new UploadService(
    unitOfWork,
    authorizer,
    storage,
    intentRepository,
    auditRepository,
  );

  const fileRepository = new PostgresFileRepository(db);
  const downloadService = new FileDownloadService(
    unitOfWork,
    authorizer,
    fileRepository,
    auditRepository,
    storage,
  );

  const entryRepository = new PostgresEntryRepository(db);
  const entryService = new EntryService(
    unitOfWork,
    authorizer,
    entryRepository,
    auditRepository,
    authzMapper,
  );

  const folderDownloadRepository = new PostgresFolderDownloadRepository(db);
  const folderDownloadService = new FolderDownloadService(
    unitOfWork,
    authorizer,
    folderDownloadRepository,
    auditRepository,
    storage,
  );

  const grantRepository = new PostgresFileGrantRepository(db);
  const sharingService = new FileSharingService(
    unitOfWork,
    authorizationService,
    authorizer,
    grantRepository,
    auditRepository,
    authzMapper,
  );

  return {
    userService,
    uploadService,
    downloadService,
    entryService,
    folderDownloadService,
    sharingService,
    auditService,
  };
}

export function createFolderDownloadWorkerComposition(db: Database, s3Config: S3Config) {
  const storage = new S3ObjectStorage(s3Config);
  const folderDownloadRepository = new PostgresFolderDownloadRepository(db);
  const folderArchiver = new StreamingFolderArchiver(storage);
  const folderDownloadProcessor = new FolderDownloadProcessor(
    folderDownloadRepository,
    folderArchiver,
  );

  return {
    folderDownloadProcessor,
  };
}

export function createObjectDeletionWorkerComposition(db: Database, s3Config: S3Config) {
  const storage = new S3ObjectStorage(s3Config);
  const objectDeletionRepository = new PostgresObjectDeletionRepository(db);
  const objectDeletionProcessor = new ObjectDeletionProcessor(objectDeletionRepository, storage);

  return {
    objectDeletionProcessor,
  };
}

export function createMaintenanceWorkerComposition(db: Database) {
  const intentRepository = new PostgresIntentRepository(db);
  const uploadCleanupService = new UploadCleanupService(intentRepository);

  const folderDownloadRepository = new PostgresFolderDownloadRepository(db);
  const folderDownloadCleanupService = new FolderDownloadCleanupService(folderDownloadRepository);

  const grantRepository = new PostgresFileGrantRepository(db);
  const fileGrantMaintenanceService = new FileGrantMaintenanceService(grantRepository);

  return {
    uploadCleanupService,
    folderDownloadCleanupService,
    fileGrantMaintenanceService,
  };
}
