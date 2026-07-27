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

console.info('Storage cleanup worker started');
