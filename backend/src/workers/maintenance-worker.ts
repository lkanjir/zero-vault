import { createCompositionRoot } from '../composition-root.js';
import cron from 'node-cron';

const BATCH_SIZE = 100;
const composition = createCompositionRoot();

const uploadCleanupTask = cron.schedule(
  '0 * * * * *',
  async () => {
    const expiredUploadCount =
      await composition.uploadCleanupService.cleanExpiredUploads(BATCH_SIZE);

    if (expiredUploadCount > 0) {
      console.info('Expired uploads queued for deletion', {
        expiredUploadCount,
      });
    }
  },
  { noOverlap: true },
);

uploadCleanupTask.on('execution:failed', (context) => {
  console.error('Upload cleanup failed', {
    error: context.execution?.error,
  });
});

const folderDownloadCleanupTask = cron.schedule(
  '0 * * * * *',
  async () => {
    const expiredArchiveCount =
      await composition.folderDownloadCleanupService.cleanExpiredDownloads(BATCH_SIZE);

    if (expiredArchiveCount > 0) {
      console.info('Expired folder archives queued for deletion', {
        expiredArchiveCount,
      });
    }
  },
  { noOverlap: true },
);

folderDownloadCleanupTask.on('execution:failed', (context) => {
  console.error('Folder download cleanup failed', {
    error: context.execution?.error,
  });
});

const fileGrantMaintenanceTask = cron.schedule(
  '0 * * * * *',
  async () => {
    const { activatedCount, deletedCount } =
      await composition.fileGrantMaintenanceService.maintainPendingGrants(BATCH_SIZE);

    if (activatedCount > 0 || deletedCount > 0) {
      console.info('Pending file grants maintained', {
        activatedCount,
        deletedCount,
      });
    }
  },
  { noOverlap: true },
);

fileGrantMaintenanceTask.on('execution:failed', (context) => {
  console.error('File grant maintenance failed', {
    error: context.execution?.error,
  });
});

console.info('Maintenance worker started');
