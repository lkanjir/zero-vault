import express, { type Router } from 'express';
import { requireUser } from '../auth/resolve-user-middleware.js';
import type { EntryService } from '../entry/entry-service.js';
import { createFolderBodySchema } from './validation-schemas.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import {
  createFolderDownloadParamsSchema,
  folderDownloadIdParamsSchema,
} from './download/validation-schemas.js';
import type { FolderDownloadService } from './download/folder-download-service.js';
import { folderDownloadRateLimiter } from '../shared/http/api-rate-limiters.js';

export type FolderRouterDeps = {
  entryService: EntryService;
  folderDownloadService: FolderDownloadService;
};

const INITIAL_POLLING_INTERVAL_SECONDS = 2;

export function createFolderRouter(deps: FolderRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/',
    validateRequest({ body: createFolderBodySchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.entryService.createFolder(authenticatedUser, validated.body);

      res.status(201).json(result);
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
