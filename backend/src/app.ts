import express from 'express';
import { errorHandler } from './shared/validation/error-handler.js';
import { requireAuth } from './auth/auth-middleware.js';
import { createCompositionRoot } from './composition-root.js';
import { createUploadRouter } from './upload/upload-routes.js';
import { createFilesRouter } from './files/files-routes.js';
import { createEntryRouter } from './entry/entry-routes.js';
import { createFolderRouter } from './folder/folder-routes.js';

export const app = express();
const composition = createCompositionRoot();

app.use(express.json({ limit: '16kb' }));

app.use('/api/uploads', requireAuth, createUploadRouter(composition));
app.use('/api/entries', requireAuth, createEntryRouter(composition));
app.use('/api/files', requireAuth, createFilesRouter(composition));
app.use('/api/folders', requireAuth, createFolderRouter(composition));

app.use(errorHandler);
