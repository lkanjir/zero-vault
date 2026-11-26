import type { Request, RequestHandler } from 'express';
import type { User } from '../user/user.js';
import type { UserService } from '../user/user-service.js';
import { requirePrincipal } from './require-principal.js';

export function createResolveUserMiddleware(userService: UserService): RequestHandler {
  return async (req, _res, next) => {
    const principal = requirePrincipal(req);
    req.user = await userService.resolveUser(principal);
    next();
  };
}

export function requireUser(req: Request): User {
  if (!req.user) {
    throw new Error('Missing resolved application user');
  }

  return req.user;
}
