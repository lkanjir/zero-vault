import express, { type Router } from 'express';
import type { FileDownloadService } from './file-download-service.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import {
  fileIdParamsSchema,
  fileShareParamsSchema,
  listFileSharesQuerySchema,
  listSharedByMeFilesQuerySchema,
  listSharedFilesQuerySchema,
  shareFileBodySchema,
  updateFileShareBodySchema,
} from './validation-schemas.js';
import type { FileSharingService } from '../sharing/file-sharing-service.js';
import type { ShareFileAcceptedResponse } from './dto.js';
import { replacementUploadRequestSchema } from '../upload/validation-schemas.js';
import type { UploadService } from '../upload/upload-service.js';
import { createUploadIntentRateLimiter } from '../upload/upload-routes.js';
import { createAuthenticatedRateLimiter } from '../shared/http/rate-limit/authenticated-rate-limiter.js';
import type { RateLimitStoreFactory } from '../shared/http/rate-limit/rate-limit-store.js';

const ONE_MINUTE_MS = 60_000;

export type FileRouterDeps = {
  downloadService: FileDownloadService;
  sharingService: FileSharingService;
  uploadService: UploadService;
  rateLimitStoreFactory: RateLimitStoreFactory;
};

export function createFilesRouter(deps: FileRouterDeps): Router {
  const router = express.Router();
  const fileDownloadRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'file-download',
    windowMs: ONE_MINUTE_MS,
    limit: 60,
    store: deps.rateLimitStoreFactory('file-download'),
  });
  const sharingReadRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'sharing-read',
    windowMs: ONE_MINUTE_MS,
    limit: 120,
    store: deps.rateLimitStoreFactory('sharing-read'),
  });
  const sharingMutationRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'sharing-mutation',
    windowMs: ONE_MINUTE_MS,
    limit: 30,
    store: deps.rateLimitStoreFactory('sharing-mutation'),
  });
  const uploadIntentRateLimiter = createUploadIntentRateLimiter(deps.rateLimitStoreFactory);

  router.post(
    '/:fileId/download-url',
    fileDownloadRateLimiter,
    validateRequest({ params: fileIdParamsSchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.downloadService.createDownloadUrl(
        authenticatedUser,
        validated.params.fileId,
      );

      res.status(200).json(result);
    }),
  );

  router.post(
    '/:fileId/shares',
    sharingMutationRateLimiter,
    validateRequest(
      { params: fileIdParamsSchema, body: shareFileBodySchema },
      async (req, res, validated) => {
        const user = requireUser(req);

        await deps.sharingService.shareFile(user, validated.params.fileId, validated.body);

        const response: ShareFileAcceptedResponse = { status: 'accepted' };
        res.status(202).json(response);
      },
    ),
  );

  router.get(
    '/:fileId/shares',
    sharingReadRateLimiter,
    validateRequest(
      { params: fileIdParamsSchema, query: listFileSharesQuerySchema },
      async (req, res, validated) => {
        const user = requireUser(req);

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
    sharingMutationRateLimiter,
    validateRequest({ params: fileShareParamsSchema }, async (req, res, validated) => {
      const user = requireUser(req);

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
    sharingMutationRateLimiter,
    validateRequest(
      { params: fileShareParamsSchema, body: updateFileShareBodySchema },
      async (req, res, validated) => {
        const user = requireUser(req);

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
    sharingReadRateLimiter,
    validateRequest({ query: listSharedFilesQuerySchema }, async (req, res, validated) => {
      const user = requireUser(req);

      const result = await deps.sharingService.listSharedFiles(user, {
        cursor: validated.query.cursor,
        limit: validated.query.limit,
      });

      res.status(200).json(result);
    }),
  );

  router.get(
    '/shared-by-me',
    sharingReadRateLimiter,
    validateRequest({ query: listSharedByMeFilesQuerySchema }, async (req, res, validated) => {
      const user = requireUser(req);

      const result = await deps.sharingService.listSharedByMeFiles(user, {
        cursor: validated.query.cursor,
        limit: validated.query.limit,
      });

      res.status(200).json(result);
    }),
  );

  router.post(
    '/:fileId/replacements',
    uploadIntentRateLimiter,
    validateRequest(
      { params: fileIdParamsSchema, body: replacementUploadRequestSchema },
      async (req, res, validated) => {
        const user = requireUser(req);

        const result = await deps.uploadService.createReplacementUpload(
          user,
          validated.params.fileId,
          validated.body,
        );

        res.status(201).json(result);
      },
    ),
  );

  return router;
}
