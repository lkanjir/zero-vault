import express, { type Router } from 'express';
import { completeUploadSchema, uploadRequestSchema } from './validation-schemas.js';
import { requirePrincipal } from '../auth/require-principal.js';
import type { UserService } from '../user/user-service.js';
import type { UploadService } from './upload-service.js';
import type { CompleteUploadUseCase } from './complete-upload-use-case.js';
import { validateRequest } from '../shared/validation/validate-request.js';

export type UploadRouterDeps = {
  userService: UserService;
  uploadService: UploadService;
  completeUploadUseCase: CompleteUploadUseCase;
};

export function createUploadRouter(deps: UploadRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/presign',
    validateRequest({ body: uploadRequestSchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.uploadService.createUpload(authenticatedUser, validated.body);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/:uploadId/complete',
    validateRequest({ params: completeUploadSchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.completeUploadUseCase.execute(
        authenticatedUser,
        validated.params.uploadId,
      );

      res.status(200).json(result);
    }),
  );

  return router;
}
