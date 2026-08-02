import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import type { FileDownloadService } from './file-download-service.js';
import { requirePrincipal } from '../auth/require-principal.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import {
  fileIdParamsSchema,
  fileShareParamsSchema,
  listFileSharesQuerySchema,
  listSharedFilesQuerySchema,
  shareFileBodySchema,
  updateFileShareBodySchema,
} from './validation-schemas.js';
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

  router.get(
    '/:fileId/shares',
    validateRequest(
      { params: fileIdParamsSchema, query: listFileSharesQuerySchema },
      async (req, res, validated) => {
        const principal = requirePrincipal(req);
        const user = await deps.userService.resolveUser(principal);

        const result = await deps.sharingService.listFileShares(user, validated.params.fileId, {
          cursor: validated.query.cursor,
          limit: validated.query.limit,
        });

        res.status(200).json(result);
      },
    ),
  );

  router.delete(
    '/:fileId/shares/:shareId',
    validateRequest({ params: fileShareParamsSchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const user = await deps.userService.resolveUser(principal);

      await deps.sharingService.revokeFileShare(
        user,
        validated.params.fileId,
        validated.params.shareId,
      );

      res.status(204).end();
    }),
  );

  router.patch(
    '/:fileId/shares/:shareId',
    validateRequest(
      { params: fileShareParamsSchema, body: updateFileShareBodySchema },
      async (req, res, validated) => {
        const principal = requirePrincipal(req);
        const user = await deps.userService.resolveUser(principal);

        const result = await deps.sharingService.updateFileShare(
          user,
          validated.params.fileId,
          validated.params.shareId,
          validated.body,
        );

        res.status(200).json(result);
      },
    ),
  );

  router.get(
    '/shared-with-me',
    validateRequest({ query: listSharedFilesQuerySchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const user = await deps.userService.resolveUser(principal);

      const result = await deps.sharingService.listSharedFiles(user, {
        cursor: validated.query.cursor,
        limit: validated.query.limit,
      });

      res.status(200).json(result);
    }),
  );

  return router;
}
