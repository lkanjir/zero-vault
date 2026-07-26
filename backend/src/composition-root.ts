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

export function createCompositionRoot() {
  const storage = new S3ObjectStorage();

  const userRepository = new PostgresUserRepository();
  const userService = new UserService(userRepository);

  const intentRepository = new PostgresIntentRepository();
  const uploadService = new UploadService(storage, intentRepository);
  const uploadCleanupService = new UploadCleanupService(intentRepository, storage);

  const fileRepository = new PostgresFileRepository();
  const downloadService = new FileDownloadService(fileRepository, storage);

  const entryRepository = new PostgresEntryRepository();
  const entryService = new EntryService(entryRepository);

  const folderService = new FolderService(entryRepository);
  const folderDownloadRepository = new PostgresFolderDownloadRepository();
  const folderDownloadService = new FolderDownloadService(folderDownloadRepository, storage);
  const folderArchiver = new StreamingFolderArchiver(storage);
  const folderDownloadProcessor = new FolderDownloadProcessor(
    folderDownloadRepository,
    folderArchiver,
  );

  const completeUploadUseCase = new CompleteUploadUseCase(uploadService);

  const objectDeletionRepository = new PostgresObjectDeletionRepository();
  const objectDeletionProcessor = new ObjectDeletionProcessor(objectDeletionRepository, storage);

  return {
    userService,
    uploadService,
    uploadCleanupService,
    completeUploadUseCase,
    downloadService,
    entryService,
    folderService,
    folderDownloadService,
    folderDownloadProcessor,
    objectDeletionProcessor,
  };
}
