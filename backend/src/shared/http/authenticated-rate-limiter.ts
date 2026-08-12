import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { requirePrincipal } from '../../auth/require-principal.js';
import { AppError } from '../errors/api/app-error.js';

export type AuthenticatedRateLimiterOptions = {
  identifier: string;
  windowMs: number;
  limit: number;
};

export function createAuthenticatedRateLimiter(
  options: AuthenticatedRateLimiterOptions,
): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    identifier: options.identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const principal = requirePrincipal(req);
      return JSON.stringify([principal.issuer, principal.subject]);
    },
    handler: (_req, _res, next) => {
      next(new AppError('rate_limit_exceeded'));
    },
  });
}
