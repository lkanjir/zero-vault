import { createCompositionRoot } from '../composition-root.js';
import cron from 'node-cron';

const BATCH_SIZE = 100;
const composition = createCompositionRoot();

const cleanupTaks = cron.schedule(
  '0 * * * * *',
  async () => {
    await composition.uploadCleanupService.cleanExpiredUploads(BATCH_SIZE);
  },
  { noOverlap: true },
);

cleanupTaks.on('execution:started', () => {
  console.info('worker: started execution');
});

cleanupTaks.on('execution:failed', (context) => {
  console.error('Upload cleanup failed', {
    error: context.execution?.error,
  });
});

console.info('Upload cleanup worker started');
