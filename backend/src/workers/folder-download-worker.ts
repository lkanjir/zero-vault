import { createFolderDownloadWorkerComposition } from '../composition-root.js';
import { loadDbConfig, loadDotenv, loadS3Config } from '../config.js';
import { createDatabase } from '../db/db-client.js';
import { registerGracefulShutdown } from '../shared/runtime/graceful-shutdown.js';
import { startWorkerLoop } from '../shared/runtime/worker-loop.js';

loadDotenv();

const database = createDatabase(loadDbConfig());
const composition = createFolderDownloadWorkerComposition(database.db, loadS3Config());

const folderDownloadLoop = startWorkerLoop({
  processNext: (signal) => composition.folderDownloadProcessor.processNext(signal),
  onJobProcessed: () => {
    console.info('Folder download job processed');
  },
  onError: (error) => {
    console.error('Folder download worker execution failed', { error });
  },
});

registerGracefulShutdown({
  name: 'Folder download worker',
  onShutdown: async () => {
    await folderDownloadLoop.stopAndDrain();
    await database.close();
  },
});

console.info('Folder download worker started');
