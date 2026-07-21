import { createCompositionRoot } from '../composition-root.js';
import cron from 'node-cron';

const composition = createCompositionRoot();

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
