import { createCompositionRoot } from '../composition-root.js';
import cron from 'node-cron';

const BATCH_SIZE = 100;
const composition = createCompositionRoot();

const cleanupTask = cron.schedule(
  '0 * * * * *',
  async () => {
    const expiredCount = await composition.uploadCleanupService.cleanExpiredUploads(BATCH_SIZE);

    if (expiredCount > 0) {
      console.info('Expired uploads queued for deletion', {
        expiredCount,
      });
    }
  },
  { noOverlap: true },
);

cleanupTask.on('execution:failed', (context) => {
  console.error('Upload cleanup failed', {
    error: context.execution?.error,
  });
});

console.info('Upload cleanup worker started');
