import express, { type Router } from 'express';
import { validateBody } from '../shared/validation/validate-body.js';
import { completeUploadSchema, uploadRequestSchema } from './validation-schemas.js';
import { validateParams } from '../shared/validation/validate-params.js';
import { requirePrincipal } from '../auth/require-principal.js';
import type { UserService } from '../user/user-service.js';
import type { UploadService } from './upload-service.js';
import type { CompleteUploadUseCase } from './complete-upload-use-case.js';

export type UploadRouterDeps = {
  userService: UserService;
  uploadService: UploadService;
  completeUploadUseCase: CompleteUploadUseCase;
};

export function createUploadRouter(deps: UploadRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/presign',
    validateBody(uploadRequestSchema, async (req, res, body) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.uploadService.createUpload(authenticatedUser, body);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/:uploadId/complete',
    validateParams(completeUploadSchema, async (req, res, params) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.completeUploadUseCase.execute(authenticatedUser, params.uploadId);

      res.status(200).json(result);
    }),
  );

  return router;
}
