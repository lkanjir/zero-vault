import type { Router } from 'express';
import express from 'express';
import type { AuditService } from './audit-service.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import { listAuditEventsQuerySchema } from './validation-schemas.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import { createAuthenticatedRateLimiter } from '../shared/http/rate-limit/authenticated-rate-limiter.js';
import type { RateLimitStoreFactory } from '../shared/http/rate-limit/rate-limit-store.js';

const ONE_MINUTE_MS = 60_000;

export type AuditRouterDeps = {
  auditService: AuditService;
  rateLimitStoreFactory: RateLimitStoreFactory;
};

export function createAuditRouter(deps: AuditRouterDeps): Router {
  const router = express.Router();
  const auditReadRateLimiter = createAuthenticatedRateLimiter({
    identifier: 'audit-read',
    windowMs: ONE_MINUTE_MS,
    limit: 60,
    store: deps.rateLimitStoreFactory('audit-read'),
  });

  router.get(
    '/events',
    auditReadRateLimiter,
    validateRequest({ query: listAuditEventsQuerySchema }, async (req, res, validated) => {
      const user = requireUser(req);

      const result = await deps.auditService.listEvents(user, validated.query);

      res.status(200).json(result);
    }),
  );

  router.get(
    '/statistics',
    auditReadRateLimiter,
    validateRequest({}, async (req, res) => {
      const user = requireUser(req);

      const result = await deps.auditService.getStatistics(user);

      res.status(200).json(result);
    }),
  );

  return router;
}
