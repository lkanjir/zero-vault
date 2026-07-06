import type { AuthenticatedPrincipal } from '../auth/authenticated-principal.js';
import type { UserRepository } from './user-repository.js';
import type { User } from './user.js';

export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async resolveUser(principal: AuthenticatedPrincipal): Promise<User> {
    let user = await this.userRepo.findByPrincipal(principal);
    if (!user) {
      user = await this.userRepo.createFromPrincipal(principal);
      user ??= await this.userRepo.findByPrincipal(principal);
    }

    if (!user) {
      throw new Error('Failed to resolve user');
    }

    if (principal.username !== undefined && principal.username !== user.username) {
      user = await this.userRepo.updateUsernameById(user.id, principal.username);
    }

    return user;
  }
}
