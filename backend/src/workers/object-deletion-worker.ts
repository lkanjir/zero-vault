import cron from 'node-cron';
import { createCompositionRoot } from '../composition-root.js';

const MAX_JOBS_PER_RUN = 100;
const composition = createCompositionRoot();

const objectDeletionTask = cron.schedule(
  '* * * * * *',
  async () => {
    let processedCount = 0;

    while (
      processedCount < MAX_JOBS_PER_RUN &&
      (await composition.objectDeletionProcessor.processNext())
    ) {
      processedCount++;
    }

    if (processedCount > 0) {
      console.info('Object deletion jobs processed', { processedCount });
    }
  },
  { noOverlap: true },
);

objectDeletionTask.on('execution:failed', (context) => {
  console.error('Object deletion worker execution failed', { error: context.execution?.error });
});

console.info('Object deletion worker started');
