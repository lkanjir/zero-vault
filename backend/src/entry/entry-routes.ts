import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import type { EntryService } from './entry-service.js';
import {
  entryIdParamsSchema,
  listEntriesQuerySchema,
  updateEntryBodySchema,
} from './validation-schemas.js';
import { requirePrincipal } from '../auth/require-principal.js';
import { validateRequest } from '../shared/validation/validate-request.js';

export type EntryRouterDeps = {
  userService: UserService;
  entryService: EntryService;
};

export function createEntryRouter(deps: EntryRouterDeps): Router {
  const router = express.Router();

  router.get(
    '/',
    validateRequest({ query: listEntriesQuerySchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.entryService.listEntries(authenticatedUser, {
        limit: validated.query.limit,
        cursor: validated.query.cursor,
        parentId: validated.query.parentId,
      });

      res.status(200).json(result);
    }),
  );

  router.patch(
    '/:entryId',
    validateRequest(
      { params: entryIdParamsSchema, body: updateEntryBodySchema },
      async (req, res, validated) => {
        const principal = requirePrincipal(req);
        const user = await deps.userService.resolveUser(principal);

        const result = await deps.entryService.updateEntry(
          user,
          validated.params.entryId,
          validated.body,
        );

        res.status(200).json(result);
      },
    ),
  );

  return router;
}
