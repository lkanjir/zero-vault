import type { RequestHandler } from 'express';
import { AppError } from '../errors/api/app-error.js';

export const routeNotFound: RequestHandler = (req, _res, next) => {
  next(
    new AppError('route_not_found', {
      context: {
        method: req.method,
        path: req.path,
      },
    }),
  );
};
