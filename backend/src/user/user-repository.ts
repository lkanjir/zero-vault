import type { AuthenticatedPrincipal } from '../auth/authenticated-principal.js';
import type { User } from './user.js';

export interface UserRepository {
  findByPrincipal(principal: AuthenticatedPrincipal): Promise<User | null>;
  createFromPrincipal(principal: AuthenticatedPrincipal): Promise<User | null>;
  updateUsernameById(id: number, newUsername: string): Promise<User>;
}
