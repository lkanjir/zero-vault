import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { S3Config } from '../src/config.js';
import type { Database } from '../src/db/db-client.js';
import {
  createApiComposition,
  createFolderDownloadWorkerComposition,
  createMaintenanceWorkerComposition,
  createObjectDeletionWorkerComposition,
} from '../src/composition-root.js';

const TEST_S3_CONFIG: S3Config = {
  endpoint: 'http://localhost:4566',
  publicOrigin: 'http://localhost:4566',
  region: 'eu-central-1',
  forcePathStyle: true,
  accessKeyId: 'test',
  secretAccessKey: 'test',
  bucket: 'test-bucket',
};

describe('entrypoint composition roots', () => {
  it('wires only API services for createApiComposition', () => {
    const db = mock<Database>();
    const composition = createApiComposition(db, TEST_S3_CONFIG);

    expect(Object.keys(composition).sort()).toStrictEqual([
      'auditService',
      'completeUploadUseCase',
      'downloadService',
      'entryService',
      'folderDownloadService',
      'sharingService',
      'uploadService',
      'userService',
    ]);
  });

  it('wires maintenance worker without S3 configuration', () => {
    const db = mock<Database>();
    const composition = createMaintenanceWorkerComposition(db);

    expect(Object.keys(composition).sort()).toStrictEqual([
      'fileGrantMaintenanceService',
      'folderDownloadCleanupService',
      'uploadCleanupService',
    ]);
  });

  it('wires only folder download processor for folder-download-worker', () => {
    const db = mock<Database>();
    const composition = createFolderDownloadWorkerComposition(db, TEST_S3_CONFIG);

    expect(Object.keys(composition)).toStrictEqual(['folderDownloadProcessor']);
  });

  it('wires only object deletion processor for object-deletion-worker', () => {
    const db = mock<Database>();
    const composition = createObjectDeletionWorkerComposition(db, TEST_S3_CONFIG);

    expect(Object.keys(composition)).toStrictEqual(['objectDeletionProcessor']);
  });
});
