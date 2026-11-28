import express, { type RequestHandler, type Router } from 'express';
import {
  completeUploadBodySchema,
  presignPartsBodySchema,
  uploadIdParamsSchema,
  uploadRequestSchema,
} from './validation-schemas.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import type { UploadService } from './upload-service.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import { createAuthenticatedRateLimiter } from '../shared/http/rate-limit/authenticated-rate-limiter.js';
import type { RateLimitStoreFactory } from '../shared/http/rate-limit/rate-limit-store.js';

const ONE_MINUTE_MS = 60_000;

export function createUploadIntentRateLimiter(storeFactory: RateLimitStoreFactory): RequestHandler {
  return createAuthenticatedRateLimiter({
    identifier: 'upload-intent',
    windowMs: ONE_MINUTE_MS,
    limit: 120,
    store: storeFactory('upload-intent'),
  });
}

export type UploadRouterDeps = {
  uploadService: UploadService;
  rateLimitStoreFactory: RateLimitStoreFactory;
};

export function createUploadRouter(deps: UploadRouterDeps): Router {
  const router = express.Router();
  const uploadIntentRateLimiter = createUploadIntentRateLimiter(deps.rateLimitStoreFactory);
  const uploadPartPresignRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'upload-part-presign',
    windowMs: ONE_MINUTE_MS,
    limit: 600,
    store: deps.rateLimitStoreFactory('upload-part-presign'),
  });
  const uploadCompletionRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'upload-completion',
    windowMs: ONE_MINUTE_MS,
    limit: 120,
    store: deps.rateLimitStoreFactory('upload-completion'),
  });

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
