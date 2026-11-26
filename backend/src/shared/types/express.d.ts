import type { AuthenticatedPrincipal } from '../../auth/authenticated-principal.js';
import type { User } from '../../user/user.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
      principal?: AuthenticatedPrincipal;
      user?: User;
    }
  }
}

export {};
