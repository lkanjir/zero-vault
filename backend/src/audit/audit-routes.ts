import type { Router } from 'express';
import express from 'express';
import type { AuditService } from './audit-service.js';
import { validateRequest } from '../shared/validation/validate-request.js';
import { listAuditEventsQuerySchema } from './validation-schemas.js';
import { requireUser } from '../auth/resolve-user-middleware.js';
import { createApiRateLimiters, type ApiRateLimiters } from '../shared/http/api-rate-limiters.js';

export type AuditRouterDeps = {
  auditService: AuditService;
  rateLimiters?: Pick<ApiRateLimiters, 'auditReadRateLimiter'>;
};

export function createAuditRouter(deps: AuditRouterDeps): Router {
  const router = express.Router();
  const rateLimiters = deps.rateLimiters ?? createApiRateLimiters();

  router.get(
    '/events',
    rateLimiters.auditReadRateLimiter,
    validateRequest({ query: listAuditEventsQuerySchema }, async (req, res, validated) => {
      const user = requireUser(req);

      const result = await deps.auditService.listEvents(user, validated.query);

      res.status(200).json(result);
    }),
  );

  router.get(
    '/statistics',
    rateLimiters.auditReadRateLimiter,
    validateRequest({}, async (req, res) => {
      const user = requireUser(req);

      const result = await deps.auditService.getStatistics(user);

      res.status(200).json(result);
    }),
  );

  return router;
}
