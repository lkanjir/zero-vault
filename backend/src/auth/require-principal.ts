import type { Request } from 'express';
import type { AuthenticatedPrincipal } from './authenticated-principal.js';

export function requirePrincipal(req: Request): AuthenticatedPrincipal {
  if (!req.principal) {
    throw new Error('Missing auth principal');
  }

  return req.principal;
}
