import type { AuthenticatedPrincipal } from '../auth/authenticated-principal.js';
import type { User } from './user.js';

export interface UserRepository {
  findByPrincipal(principal: AuthenticatedPrincipal): Promise<User | null>;
  createFromPrincipal(principal: AuthenticatedPrincipal): Promise<User | null>;
  updateProfileById(id: number, profile: { email: string; username?: string }): Promise<User>;
}
