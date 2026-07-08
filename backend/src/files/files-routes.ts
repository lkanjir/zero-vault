import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import type { FileDownloadService } from './file-download-service.js';
import { validateParams } from '../shared/validation/validate-params.js';
import { fileIdParamsSchema } from './validation-schemas.js';
import { requirePrincipal } from '../auth/require-principal.js';

export type FileRouterDeps = {
  userService: UserService;
  downloadService: FileDownloadService;
};

export function createFilesRouter(deps: FileRouterDeps): Router {
  const router = express.Router();

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
