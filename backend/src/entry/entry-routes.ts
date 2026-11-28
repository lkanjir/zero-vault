import express, { type RequestHandler, type Router } from 'express';
import type { EntryService } from './entry-service.js';
import {
  entryIdParamsSchema,
  listEntriesQuerySchema,
  updateEntryBodySchema,
} from './validation-schemas.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import { createAuthenticatedRateLimiter } from '../shared/http/rate-limit/authenticated-rate-limiter.js';
import type { RateLimitStoreFactory } from '../shared/http/rate-limit/rate-limit-store.js';
import { validateRequest } from '../shared/validation/validate-request.js';

const ONE_MINUTE_MS = 60_000;

export function createEntryMutationRateLimiter(
  storeFactory: RateLimitStoreFactory,
): RequestHandler {
  return createAuthenticatedRateLimiter({
    identifier: 'entry-mutation',
    windowMs: ONE_MINUTE_MS,
    limit: 120,
    store: storeFactory('entry-mutation'),
  });
}

export type EntryRouterDeps = {
  entryService: EntryService;
  rateLimitStoreFactory: RateLimitStoreFactory;
};

export function createEntryRouter(deps: EntryRouterDeps): Router {
  const router = express.Router();
  const entryReadRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'entry-read',
    windowMs: ONE_MINUTE_MS,
    limit: 180,
    store: deps.rateLimitStoreFactory('entry-read'),
  });
  const entryMutationRateLimiter = createEntryMutationRateLimiter(deps.rateLimitStoreFactory);

  router.get(
    '/',
    entryReadRateLimiter,
    validateRequest({ query: listEntriesQuerySchema }, async (req, res, validated) => {
      const authenticatedUser = requireUser(req);

      const result = await deps.entryService.listEntries(authenticatedUser, {
        limit: validated.query.limit,
        cursor: validated.query.cursor,
        parentId: validated.query.parentId,
        sort: validated.query.sort,
        kind: validated.query.kind,
        search: validated.query.search,
      });

      res.status(200).json(result);
    }),
  );

  router.patch(
    '/:entryId',
    entryMutationRateLimiter,
    validateRequest(
      { params: entryIdParamsSchema, body: updateEntryBodySchema },
      async (req, res, validated) => {
        const user = requireUser(req);

        const result = await deps.entryService.updateEntry(
          user,
          validated.params.entryId,
          validated.body,
        );

        res.status(200).json(result);
      },
    ),
  );

  router.delete(
    '/:entryId',
    entryMutationRateLimiter,
    validateRequest({ params: entryIdParamsSchema }, async (req, res, validated) => {
      const user = requireUser(req);

      await deps.entryService.deleteEntry(user, validated.params.entryId);

      res.status(204).end();
    }),
  );

  return router;
}
