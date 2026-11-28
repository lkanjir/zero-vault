import { createMaintenanceWorkerComposition } from '../composition-root.js';
import { loadDbConfig, loadDotenv } from '../config.js';
import { createDatabase } from '../db/db-client.js';
import {
  registerGracefulShutdown,
  runShutdownSteps,
  scheduleManagedCronTask,
} from '../shared/runtime/graceful-shutdown.js';

loadDotenv();

const BATCH_SIZE = 100;
const database = createDatabase(loadDbConfig());
const composition = createMaintenanceWorkerComposition(database.db);

const uploadCleanupTask = scheduleManagedCronTask({
  expression: '0 * * * * *',
  run: async () => {
    const expiredUploadCount =
      await composition.uploadCleanupService.cleanExpiredUploads(BATCH_SIZE);

    if (expiredUploadCount > 0) {
      console.info('Expired uploads queued for deletion', {
        expiredUploadCount,
      });
    }
  },
  onError: (error) => {
    console.error('Upload cleanup failed', { error });
  },
});

const folderDownloadCleanupTask = scheduleManagedCronTask({
  expression: '0 * * * * *',
  run: async () => {
    const expiredArchiveCount =
      await composition.folderDownloadCleanupService.cleanExpiredDownloads(BATCH_SIZE);

    if (expiredArchiveCount > 0) {
      console.info('Expired folder archives queued for deletion', {
        expiredArchiveCount,
      });
    }
  },
  onError: (error) => {
    console.error('Folder download cleanup failed', { error });
  },
});

const fileGrantMaintenanceTask = scheduleManagedCronTask({
  expression: '0 * * * * *',
  run: async () => {
    const { activatedCount, deletedCount } =
      await composition.fileGrantMaintenanceService.maintainPendingGrants(BATCH_SIZE);

    if (activatedCount > 0 || deletedCount > 0) {
      console.info('Pending file grants maintained', {
        activatedCount,
        deletedCount,
      });
    }
  },
  onError: (error) => {
    console.error('File grant maintenance failed', { error });
  },
});

registerGracefulShutdown({
  name: 'Maintenance worker',
  onShutdown: () =>
    runShutdownSteps([
      async () => {
        await Promise.all([
          uploadCleanupTask.stopAndDrain(),
          folderDownloadCleanupTask.stopAndDrain(),
          fileGrantMaintenanceTask.stopAndDrain(),
        ]);
      },
      () => database.close(),
    ]),
});

console.info('Maintenance worker started');
