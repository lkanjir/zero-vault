import express, { type Router } from 'express';
import { completeUploadSchema, uploadRequestSchema } from './validation-schemas.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import type { UploadService } from './upload-service.js';
import type { CompleteUploadUseCase } from './complete-upload-use-case.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import {
  uploadCompletionRateLimiter,
  uploadIntentRateLimiter,
} from '../shared/http/api-rate-limiters.js';

export type UploadRouterDeps = {
  uploadService: UploadService;
  completeUploadUseCase: CompleteUploadUseCase;
};

export function createUploadRouter(deps: UploadRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/presign',
    uploadIntentRateLimiter,
    validateRequest({ body: uploadRequestSchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.uploadService.createUpload(authenticatedUser, validated.body);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/:uploadId/complete',
    uploadCompletionRateLimiter,
    validateRequest({ params: completeUploadSchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.completeUploadUseCase.execute(
        authenticatedUser,
        validated.params.uploadId,
      );

      res.status(200).json(result);
    }),
  );

  return router;
}
