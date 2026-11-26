import { createFolderDownloadWorkerComposition } from '../composition-root.js';
import { loadDbConfig, loadDotenv, loadS3Config } from '../config.js';
import { createDatabase } from '../db/db-client.js';
import {
  registerGracefulShutdown,
  scheduleManagedCronTask,
} from '../shared/runtime/graceful-shutdown.js';

loadDotenv();

const database = createDatabase(loadDbConfig());
const composition = createFolderDownloadWorkerComposition(database.db, loadS3Config());

const folderDownloadTask = scheduleManagedCronTask({
  expression: '* * * * * *',
  run: async () => {
    const processed = await composition.folderDownloadProcessor.processNext();

    if (processed) {
      console.info('Folder download job processed');
    }
  },
  onError: (error) => {
    console.error('Folder download worker execution failed', { error });
  },
});

registerGracefulShutdown({
  name: 'Folder download worker',
  onShutdown: async () => {
    await folderDownloadTask.stopAndDrain();
    await database.close();
  },
});

console.info('Folder download worker started');
