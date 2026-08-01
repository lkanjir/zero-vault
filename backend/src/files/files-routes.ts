import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import type { FileDownloadService } from './file-download-service.js';
import { requirePrincipal } from '../auth/require-principal.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import { fileIdParamsSchema, shareFileBodySchema } from './validation-schemas.js';
import type { FileSharingService } from '../sharing/file-sharing-service.js';
import type { ShareFileAcceptedResponse } from './dto.js';

export type FileRouterDeps = {
  userService: UserService;
  downloadService: FileDownloadService;
  sharingService: FileSharingService;
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

  router.post(
    '/:fileId/shares',
    validateRequest(
      { params: fileIdParamsSchema, body: shareFileBodySchema },
      async (req, res, validated) => {
        const principal = requirePrincipal(req);
        const user = await deps.userService.resolveUser(principal);

        await deps.sharingService.shareFile(user, validated.params.fileId, validated.body);

        const response: ShareFileAcceptedResponse = { status: 'accepted' };
        res.status(202).json(response);
      },
    ),
  );

  return router;
}
