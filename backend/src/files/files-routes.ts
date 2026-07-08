import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import type { FileDownloadService } from './file-download-service.js';
import { validateParams } from '../shared/validation/validate-params.js';
import { fileIdParamsSchema, listEntriesQuerySchema } from './validation-schemas.js';
import { requirePrincipal } from '../auth/require-principal.js';
import type { FileListingService } from './file-listing-service.js';
import { validateQuery } from '../shared/validation/validate-query.js';

export type FileRouterDeps = {
  userService: UserService;
  downloadService: FileDownloadService;
  listingService: FileListingService;
};

export function createFilesRouter(deps: FileRouterDeps): Router {
  const router = express.Router();

  router.get(
    '/',
    validateQuery(listEntriesQuerySchema, async (req, res, query) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.listingService.listEntries(authenticatedUser, {
        limit: query.limit,
        cursor: query.cursor,
        parentId: query.parentId,
      });

      res.status(200).json(result);
    }),
  );

  router.post(
    '/:fileId/download',
    validateParams(fileIdParamsSchema, async (req, res, params) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.downloadService.createDownloadUrl(authenticatedUser, params.fileId);

      res.status(200).json(result);
    }),
  );

  return router;
}
