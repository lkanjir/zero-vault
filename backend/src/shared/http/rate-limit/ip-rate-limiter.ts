import type { RequestHandler } from 'express';
import rateLimit, { type Store } from 'express-rate-limit';
import { AppError } from '../../errors/api/app-error.js';

export type IpRateLimiterOptions = {
  identifier: string;
  windowMs: number;
  limit: number;
  store: Store;
};

export function createIpRateLimiter(options: IpRateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    identifier: options.identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: options.store,
    handler: (_req, _res, next) => {
      next(new AppError('rate_limit_exceeded'));
    },
  });
}
