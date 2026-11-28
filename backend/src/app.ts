import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { createAccessTokenVerifier } from './auth/access-token-verifier.js';
import { createRequireAuthMiddleware } from './auth/auth-middleware.js';
import { createResolveUserMiddleware } from './auth/resolve-user-middleware.js';
import { createApiComposition } from './composition-root.js';
import { createUploadRouter } from './upload/upload-routes.js';
import { createFilesRouter } from './files/files-routes.js';
import { createEntryRouter } from './entry/entry-routes.js';
import { createFolderRouter } from './folder/folder-routes.js';
import { requestContext } from './shared/http/request-context.js';
import { errorHandler } from './shared/http/error-handler.js';
import { createHealthRouter } from './shared/http/health-routes.js';
import { createPublicConfigRouter } from './shared/http/config-routes.js';
import { createIpRateLimiter } from './shared/http/rate-limit/ip-rate-limiter.js';
import type { RateLimitStoreFactory } from './shared/http/rate-limit/rate-limit-store.js';
import { createRedisRateLimitStoreFactory } from './shared/http/rate-limit/redis-rate-limit-store.js';
import { routeNotFound } from './shared/http/route-not-found.js';
import { createAuditRouter } from './audit/audit-routes.js';
import { createFrontendRouter } from './frontend/frontend-routes.js';
import type { DatabaseHandle } from './db/db-client.js';
import type { RedisHandle } from './redis/redis-client.js';
import type { ApiConfig } from './config.js';

const HSTS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const GLOBAL_IP_RATE_LIMIT_WINDOW_MS = 60_000;
const GLOBAL_IP_RATE_LIMIT_MAX_REQUESTS = 1_000;

export type CreateAppOptions = {
  readonly config: ApiConfig;
  readonly database: DatabaseHandle;
  readonly redis: RedisHandle;
  readonly rateLimitStoreFactory?: RateLimitStoreFactory;
  readonly globalIpRateLimiter?: RequestHandler;
};

export function createApp({
  config,
  database,
  redis,
  rateLimitStoreFactory: customRateLimitStoreFactory,
  globalIpRateLimiter: customGlobalIpRateLimiter,
}: CreateAppOptions): Express {
  const app = express();
  const composition = createApiComposition(database.db, config.s3, {
    uploadLimits: config.uploadLimits,
    folderDownloadLimits: config.folderDownloadLimits,
  });
  const requireAuth = createRequireAuthMiddleware(createAccessTokenVerifier(config.oidc));
  const resolveUser = createResolveUserMiddleware(composition.userService);
  const rateLimitStoreFactory =
    customRateLimitStoreFactory ?? createRedisRateLimitStoreFactory(redis);
  const globalIpRateLimiter =
    customGlobalIpRateLimiter ??
    createIpRateLimiter({
      identifier: 'api-ip',
      windowMs: GLOBAL_IP_RATE_LIMIT_WINDOW_MS,
      limit: GLOBAL_IP_RATE_LIMIT_MAX_REQUESTS,
      store: rateLimitStoreFactory('api-ip'),
    });

  app.disable('x-powered-by');
  app.set('trust proxy', config.http.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      strictTransportSecurity: config.http.hstsEnabled
        ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: false, preload: false }
        : false,
    }),
  );

  app.use(requestContext);
  app.use(
    createHealthRouter(async () => {
      await Promise.all([database.checkConnection(), redis.checkConnection()]);
    }),
  );

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', globalIpRateLimiter);
  app.use('/api', createPublicConfigRouter(config.oidc));

  // Upload and folder routes own route-specific JSON body limits (2mb on upload completion,
  // 512kb on folder tree creation, 16kb elsewhere) so auth and rate limiting run before parsing.
  app.use(
    '/api/uploads',
    requireAuth,
    resolveUser,
    createUploadRouter({ ...composition, rateLimitStoreFactory }),
  );
  app.use(
    '/api/folders',
    requireAuth,
    resolveUser,
    createFolderRouter({ ...composition, rateLimitStoreFactory }),
  );

  app.use(express.json({ limit: '16kb' }));

  app.use(
    '/api/entries',
    requireAuth,
    resolveUser,
    createEntryRouter({ ...composition, rateLimitStoreFactory }),
  );
  app.use(
    '/api/files',
    requireAuth,
    resolveUser,
    createFilesRouter({ ...composition, rateLimitStoreFactory }),
  );
  app.use(
    '/api/audit',
    requireAuth,
    resolveUser,
    createAuditRouter({ ...composition, rateLimitStoreFactory }),
  );

  app.use('/api', routeNotFound);

  app.use(
    createFrontendRouter({
      oidcOrigin: new URL(config.oidc.issuer).origin,
      storageOrigin: config.s3.publicOrigin,
    }),
  );

  app.use(routeNotFound);
  app.use(errorHandler);

  return app;
}
