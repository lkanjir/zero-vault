import express, { type Router } from 'express';
import type { EntryService } from './entry-service.js';
import {
  entryIdParamsSchema,
  listEntriesQuerySchema,
  updateEntryBodySchema,
} from './validation-schemas.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import { validateRequest } from '../shared/validation/validate-request.js';

export type EntryRouterDeps = {
  entryService: EntryService;
};

export function createEntryRouter(deps: EntryRouterDeps): Router {
  const router = express.Router();

  router.get(
    '/',
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
    validateRequest({ params: entryIdParamsSchema }, async (req, res, validated) => {
      const user = requireUser(req);

      await deps.entryService.deleteEntry(user, validated.params.entryId);

      res.status(204).end();
    }),
  );

  return router;
}
