import cron from 'node-cron';
import { createFolderDownloadWorkerComposition } from '../composition-root.js';
import { loadDbConfig, loadDotenv, loadS3Config } from '../config.js';
import { createDatabase } from '../db/db-client.js';

loadDotenv();

const database = createDatabase(loadDbConfig());
const composition = createFolderDownloadWorkerComposition(database.db, loadS3Config());

const folderDownloadTask = cron.schedule(
  '* * * * * *',
  async () => {
    const processed = await composition.folderDownloadProcessor.processNext();

    if (processed) {
      console.info('Folder download job processed');
    }
  },
  { noOverlap: true },
);

folderDownloadTask.on('execution:failed', (context) => {
  console.error('Folder download worker execution failed', {
    error: context.execution?.error,
  });
});

console.info('Folder download worker started');
