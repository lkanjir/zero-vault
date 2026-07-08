import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import { requirePrincipal } from '../auth/require-principal.js';
import type { FolderService } from '../folder/folder-service.js';
import { createFolderBodySchema } from './validation-schemas.js';
import { validateRequest } from '../shared/validation/validate-request.js';

export type FolderRouterDeps = {
  userService: UserService;
  folderService: FolderService;
};

export function createFolderRouter(deps: FolderRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/',
    validateRequest({ body: createFolderBodySchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.folderService.createFolder(authenticatedUser, validated.body);

      res.status(201).json(result);
    }),
  );

  return router;
}
