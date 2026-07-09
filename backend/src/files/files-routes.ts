import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import type { FileDownloadService } from './file-download-service.js';
import { requirePrincipal } from '../auth/require-principal.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import { fileIdParamsSchema } from './validation-schemas.js';

export type FileRouterDeps = {
  userService: UserService;
  downloadService: FileDownloadService;
};

export function createFilesRouter(deps: FileRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/:fileId/download-url',
    validateRequest({ params: fileIdParamsSchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.downloadService.createDownloadUrl(
        authenticatedUser,
        validated.params.fileId,
      );

      res.status(200).json(result);
    }),
  );

  return router;
}
