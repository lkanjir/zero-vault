import express from 'express';
import { requireAuth } from './auth/auth-middleware.js';
import { createCompositionRoot } from './composition-root.js';
import { createUploadRouter } from './upload/upload-routes.js';
import { createFilesRouter } from './files/files-routes.js';
import { createEntryRouter } from './entry/entry-routes.js';
import { createFolderRouter } from './folder/folder-routes.js';
import { requestContext } from './shared/http/request-context.js';
import { errorHandler } from './shared/http/error-handler.js';
import { routeNotFound } from './shared/http/route-not-found.js';
import { createAuditRouter } from './audit/audit-routes.js';

export const app = express();
const composition = createCompositionRoot();

app.use(requestContext);
app.use(express.json({ limit: '16kb' }));

app.use('/api/uploads', requireAuth, createUploadRouter(composition));
app.use('/api/entries', requireAuth, createEntryRouter(composition));
app.use('/api/files', requireAuth, createFilesRouter(composition));
app.use('/api/folders', requireAuth, createFolderRouter(composition));
app.use('/api/audit', requireAuth, createAuditRouter(composition));

app.use(routeNotFound);
app.use(errorHandler);
