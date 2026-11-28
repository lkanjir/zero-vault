import express, { type Router } from 'express';
import { requireUser } from '../auth/resolve-user-middleware.js';
import type { EntryService } from '../entry/entry-service.js';
import { createFolderBodySchema, ensureFolderTreeBodySchema } from './validation-schemas.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import {
  createFolderDownloadParamsSchema,
  folderDownloadIdParamsSchema,
} from './download/validation-schemas.js';
import type { FolderDownloadService } from './download/folder-download-service.js';
import { createEntryMutationRateLimiter } from '../entry/entry-routes.js';
import { createAuthenticatedRateLimiter } from '../shared/http/rate-limit/authenticated-rate-limiter.js';
import type { RateLimitStoreFactory } from '../shared/http/rate-limit/rate-limit-store.js';

const ONE_MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;

export type FolderRouterDeps = {
  entryService: EntryService;
  folderDownloadService: FolderDownloadService;
  rateLimitStoreFactory: RateLimitStoreFactory;
};

const INITIAL_POLLING_INTERVAL_SECONDS = 2;

export function createFolderRouter(deps: FolderRouterDeps): Router {
  const router = express.Router();
  const entryMutationRateLimiter = createEntryMutationRateLimiter(deps.rateLimitStoreFactory);
  const folderTreeRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'folder-tree',
    windowMs: ONE_MINUTE_MS,
    limit: 60,
    store: deps.rateLimitStoreFactory('folder-tree'),
  });
  const folderDownloadRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'folder-download',
    windowMs: TEN_MINUTES_MS,
    limit: 10,
    store: deps.rateLimitStoreFactory('folder-download'),
  });
  const folderDownloadStatusRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'folder-download-status',
    windowMs: ONE_MINUTE_MS,
    limit: 120,
    store: deps.rateLimitStoreFactory('folder-download-status'),
  });

  router.post(
    '/',
    entryMutationRateLimiter,
    express.json({ limit: '16kb' }),
    validateRequest({ body: createFolderBodySchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.entryService.createFolder(authenticatedUser, validated.body);

      res.status(201).json(result);
    }),
  );

  router.post(
    '/tree',
    folderTreeRateLimiter,
    express.json({ limit: '512kb' }),
    validateRequest({ body: ensureFolderTreeBodySchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.entryService.ensureFolderTree(authenticatedUser, validated.body);

      res.status(200).json(result);
    }),
  );

  router.post(
    '/:folderId/downloads',
    folderDownloadRateLimiter,
    validateRequest({ params: createFolderDownloadParamsSchema }, async (req, res, validated) => {
      const user = requireUser(req);

      const result = await deps.folderDownloadService.createDownload(
        user,
        validated.params.folderId,
      );

      res.location(`/api/folders/downloads/${result.downloadId}`);
      res.setHeader('Retry-After', INITIAL_POLLING_INTERVAL_SECONDS.toString());
      res.status(202).json(result);
    }),
  );

  router.get(
    '/downloads/:downloadId',
    folderDownloadStatusRateLimiter,
    validateRequest({ params: folderDownloadIdParamsSchema }, async (req, res, validated) => {
      const user = requireUser(req);

      const result = await deps.folderDownloadService.getStatus(user, validated.params.downloadId);

      res.setHeader('Cache-Control', 'no-store');
      if (result.status === 'queued' || result.status === 'processing') {
        res.setHeader('Retry-After', INITIAL_POLLING_INTERVAL_SECONDS.toString());
      }

      res.status(200).json(result);
    }),
  );

  return router;
}
