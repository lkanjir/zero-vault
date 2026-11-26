import express, { type Router } from 'express';
import {
  completeUploadBodySchema,
  presignPartsBodySchema,
  uploadIdParamsSchema,
  uploadRequestSchema,
} from './validation-schemas.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import type { UploadService } from './upload-service.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import {
  uploadCompletionRateLimiter,
  uploadIntentRateLimiter,
  uploadPartPresignRateLimiter,
} from '../shared/http/api-rate-limiters.js';

export type UploadRouterDeps = {
  uploadService: UploadService;
};

export function createUploadRouter(deps: UploadRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/presign',
    uploadIntentRateLimiter,
    express.json({ limit: '16kb' }),
    validateRequest({ body: uploadRequestSchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.uploadService.createUpload(authenticatedUser, validated.body);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/:uploadId/parts/presign',
    uploadPartPresignRateLimiter,
    express.json({ limit: '16kb' }),
    validateRequest(
      { params: uploadIdParamsSchema, body: presignPartsBodySchema },
      async (req, res, validated) => {
        const authenticatedUser = requireUser(req);

        const result = await deps.uploadService.presignParts(
          authenticatedUser,
          validated.params.uploadId,
          validated.body,
        );

        res.status(200).json(result);
      },
    ),
  );

  router.post(
    '/:uploadId/complete',
    uploadCompletionRateLimiter,
    express.json({ limit: '2mb' }),
    validateRequest(
      { params: uploadIdParamsSchema, body: completeUploadBodySchema },
      async (req, res, validated) => {
        const authenticatedUser = requireUser(req);

        const result = await deps.uploadService.completeUpload(
          authenticatedUser,
          validated.params.uploadId,
          validated.body,
        );

        res.status(200).json(result);
      },
    ),
  );

  router.post(
    '/:uploadId/abort',
    uploadCompletionRateLimiter,
    validateRequest({ params: uploadIdParamsSchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      await deps.uploadService.abortUpload(authenticatedUser, validated.params.uploadId);
      res.status(204).end();
    }),
  );

  return router;
}
