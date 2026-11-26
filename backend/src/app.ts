import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth/auth-middleware.js';
import { createResolveUserMiddleware } from './auth/resolve-user-middleware.js';
import { createCompositionRoot } from './composition-root.js';
import { createUploadRouter } from './upload/upload-routes.js';
import { createFilesRouter } from './files/files-routes.js';
import { createEntryRouter } from './entry/entry-routes.js';
import { createFolderRouter } from './folder/folder-routes.js';
import { requestContext } from './shared/http/request-context.js';
import { errorHandler } from './shared/http/error-handler.js';
import { routeNotFound } from './shared/http/route-not-found.js';
import { createAuditRouter } from './audit/audit-routes.js';
import { createFrontendRouter } from './frontend/frontend-routes.js';
import { config } from './config.js';

const HSTS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const app = express();
const composition = createCompositionRoot();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false,
    strictTransportSecurity: config.http.hstsEnabled
      ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: false, preload: false }
      : false,
  }),
);

app.use(requestContext);
app.use(express.json({ limit: '16kb' }));

const resolveUser = createResolveUserMiddleware(composition.userService);

app.use('/api/uploads', requireAuth, resolveUser, createUploadRouter(composition));
app.use('/api/entries', requireAuth, resolveUser, createEntryRouter(composition));
app.use('/api/files', requireAuth, resolveUser, createFilesRouter(composition));
app.use('/api/folders', requireAuth, resolveUser, createFolderRouter(composition));
app.use('/api/audit', requireAuth, resolveUser, createAuditRouter(composition));

app.use('/api', routeNotFound);

app.use(createFrontendRouter());

app.use(routeNotFound);
app.use(errorHandler);
