import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import { requirePrincipal } from '../auth/require-principal.js';
import { validateBody } from '../shared/validation/validate-body.js';
import type { FolderService } from '../folder/folder-service.js';
import { createFolderBodySchema } from './validation-schemas.js';

export type FolderRouterDeps = {
  userService: UserService;
  folderService: FolderService;
};

export function createFolderRouter(deps: FolderRouterDeps): Router {
  const router = express.Router();

  router.post(
    '/',
    validateBody(createFolderBodySchema, async (req, res, body) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.folderService.createFolder(authenticatedUser, body);

      res.status(201).json(result);
    }),
  );

  return router;
}
