import { createObjectDeletionWorkerComposition } from '../composition-root.js';
import { loadDbConfig, loadDotenv, loadS3Config } from '../config.js';
import { createDatabase } from '../db/db-client.js';
import {
  registerGracefulShutdown,
  scheduleManagedCronTask,
} from '../shared/runtime/graceful-shutdown.js';

loadDotenv();

const MAX_JOBS_PER_RUN = 100;
const database = createDatabase(loadDbConfig());
const composition = createObjectDeletionWorkerComposition(database.db, loadS3Config());

const objectDeletionTask = scheduleManagedCronTask({
  expression: '* * * * * *',
  run: async () => {
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
  onError: (error) => {
    console.error('Object deletion worker execution failed', { error });
  },
});

registerGracefulShutdown({
  name: 'Object deletion worker',
  onShutdown: async () => {
    await objectDeletionTask.stopAndDrain();
    await database.close();
  },
});

console.info('Object deletion worker started');
