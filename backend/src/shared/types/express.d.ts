import type { AuthenticatedPrincipal } from '../../auth/authenticated-principal.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
      principal?: AuthenticatedPrincipal;
    }
  }
}

export {};
