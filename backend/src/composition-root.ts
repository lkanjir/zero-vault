import { FileDownloadService } from './files/file-download-service.js';
import { FileListingService } from './files/file-listing-service.js';
import { FilePromotionService } from './files/file-promotion-service.js';
import { PostgresEntryRepository } from './files/postgres-entry-repository.js';
import { PostgresFileRepository } from './files/postgres-file-repository.js';
import { S3ObjectStorage } from './storage/s3-object-storage.js';
import { CompleteUploadUseCase } from './upload/complete-upload-use-case.js';
import { PostgresIntentRepository } from './upload/postgres-intent-repository.js';
import { UploadService } from './upload/upload-service.js';
import { PostgresUserRepository } from './user/postgres-user-repository.js';
import { UserService } from './user/user-service.js';

export function createCompositionRoot() {
  const storage = new S3ObjectStorage();

  const userRepository = new PostgresUserRepository();
  const userService = new UserService(userRepository);

  const intentRepository = new PostgresIntentRepository();
  const uploadService = new UploadService(storage, intentRepository);

  const fileRepository = new PostgresFileRepository();
  const filePromotionService = new FilePromotionService(fileRepository, storage);
  const downloadService = new FileDownloadService(fileRepository, storage);

  const entryRepository = new PostgresEntryRepository();
  const listingService = new FileListingService(entryRepository);

  const completeUploadUseCase = new CompleteUploadUseCase(uploadService, filePromotionService);

  return {
    userService,
    uploadService,
    completeUploadUseCase,
    downloadService,
    listingService,
  };
}
