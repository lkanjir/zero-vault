import type { Router } from 'express';
import express from 'express';
import type { UserService } from '../user/user-service.js';
import type { AuditService } from './audit-service.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import { listAuditEventsQuerySchema } from './validation-schemas.js';
import { requirePrincipal } from '../auth/require-principal.js';

export type AuditRouterDeps = {
  userService: UserService;
  auditService: AuditService;
};

export function createAuditRouter(deps: AuditRouterDeps): Router {
  const router = express.Router();

  router.get(
    '/events',
    validateRequest({ query: listAuditEventsQuerySchema }, async (req, res, validated) => {
      const principal = requirePrincipal(req);
      const user = await deps.userService.resolveUser(principal);

      const result = await deps.auditService.listEvents(user, validated.query);

      res.status(200).json(result);
    }),
  );

  router.get(
    '/statistics',
    validateRequest({}, async (req, res) => {
      const principal = requirePrincipal(req);
      const user = await deps.userService.resolveUser(principal);

      const result = await deps.auditService.getStatistics(user);

      res.status(200).json(result);
    }),
  );

  return router;
}
