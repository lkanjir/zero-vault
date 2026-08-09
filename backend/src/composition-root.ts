import { FileDownloadService } from './files/file-download-service.js';
import { EntryService } from './entry/entry-service.js';
import { FolderService } from './folder/folder-service.js';
import { PostgresEntryRepository } from './entry/postgres-entry-repository.js';
import { PostgresFileRepository } from './files/postgres-file-repository.js';
import { S3ObjectStorage } from './storage/s3-object-storage.js';
import { CompleteUploadUseCase } from './upload/complete-upload-use-case.js';
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

export function createCompositionRoot() {
  const authorizationContextResolver = new PostgresAuthorizationContextResolver();
  const authorizationPolicy = new AuthorizationPolicy();
  const authorizationService = new AuthorizationService(
    authorizationContextResolver,
    authorizationPolicy,
  );
  const authzMapper = new EntryAccessMapper(authorizationPolicy);
  const authorizer = new PostgresEntryAuthorizer(authorizationService);

  const storage = new S3ObjectStorage();

  const auditRepository = new PostgresAuditRepository();

  const userRepository = new PostgresUserRepository();
  const userService = new UserService(userRepository);

  const intentRepository = new PostgresIntentRepository(authorizer);
  const uploadService = new UploadService(storage, intentRepository);
  const uploadCleanupService = new UploadCleanupService(intentRepository);

  const fileRepository = new PostgresFileRepository();
  const downloadService = new FileDownloadService(
    authorizationService,
    fileRepository,
    auditRepository,
    storage,
  );

  const entryRepository = new PostgresEntryRepository(authorizer);
  const entryService = new EntryService(entryRepository, authzMapper);

  const folderService = new FolderService(entryRepository);
  const folderDownloadRepository = new PostgresFolderDownloadRepository();
  const folderDownloadService = new FolderDownloadService(
    authorizationService,
    folderDownloadRepository,
    storage,
  );
  const folderArchiver = new StreamingFolderArchiver(storage);
  const folderDownloadProcessor = new FolderDownloadProcessor(
    folderDownloadRepository,
    folderArchiver,
  );
  const folderDownloadCleanupService = new FolderDownloadCleanupService(folderDownloadRepository);

  const completeUploadUseCase = new CompleteUploadUseCase(uploadService);

  const objectDeletionRepository = new PostgresObjectDeletionRepository();
  const objectDeletionProcessor = new ObjectDeletionProcessor(objectDeletionRepository, storage);

  const grantRepository = new PostgresFileGrantRepository(authorizer);
  const sharingService = new FileSharingService(authorizationService, grantRepository, authzMapper);
  const fileGrantMaintenanceService = new FileGrantMaintenanceService(grantRepository);

  return {
    userService,
    uploadService,
    uploadCleanupService,
    completeUploadUseCase,
    downloadService,
    entryService,
    folderService,
    folderDownloadService,
    folderDownloadCleanupService,
    folderDownloadProcessor,
    objectDeletionProcessor,
    sharingService,
    fileGrantMaintenanceService,
  };
}
