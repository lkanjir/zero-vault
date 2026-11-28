import { createObjectDeletionWorkerComposition } from '../composition-root.js';
import { loadDbConfig, loadDotenv, loadS3Config } from '../config.js';
import { createDatabase } from '../db/db-client.js';
import { registerGracefulShutdown, runShutdownSteps } from '../shared/runtime/graceful-shutdown.js';
import { startWorkerLoop } from '../shared/runtime/worker-loop.js';

loadDotenv();

const database = createDatabase(loadDbConfig());
const composition = createObjectDeletionWorkerComposition(database.db, loadS3Config());

const objectDeletionLoop = startWorkerLoop({
  processNext: (signal) => composition.objectDeletionProcessor.processNext(signal),
  onIdle: (processedCount) => {
    console.info('Object deletion jobs processed', { processedCount });
  },
  onError: (error) => {
    console.error('Object deletion worker execution failed', { error });
  },
});

registerGracefulShutdown({
  name: 'Object deletion worker',
  onShutdown: () =>
    runShutdownSteps([() => objectDeletionLoop.stopAndDrain(), () => database.close()]),
});

console.info('Object deletion worker started');
