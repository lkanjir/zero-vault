import type { AuthenticatedPrincipal } from '../../auth/authenticated-principal.js';

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

export {};
