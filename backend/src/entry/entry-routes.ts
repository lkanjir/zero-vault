import express, { type Router } from 'express';
import type { UserService } from '../user/user-service.js';
import type { EntryListingService } from './entry-listing-service.js';
import { validateQuery } from '../shared/validation/validate-query.js';
import { listEntriesQuerySchema } from './validation-schemas.js';
import { requirePrincipal } from '../auth/require-principal.js';

export type EntryRouterDeps = {
  userService: UserService;
  listingService: EntryListingService;
};

export function createEntryRouter(deps: EntryRouterDeps): Router {
  const router = express.Router();

  router.get(
    '/',
    validateQuery(listEntriesQuerySchema, async (req, res, query) => {
      const principal = requirePrincipal(req);
      const authenticatedUser = await deps.userService.resolveUser(principal);

      const result = await deps.listingService.listEntries(authenticatedUser, {
        limit: query.limit,
        cursor: query.cursor,
        parentId: query.parentId,
      });

      res.status(200).json(result);
    }),
  );

  return router;
}
