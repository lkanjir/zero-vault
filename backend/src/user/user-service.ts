import type { AuthenticatedPrincipal } from '../auth/authenticated-principal.js';
import { AppError } from '../shared/errors/api/app-error.js';
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

    if (user.deletedAt !== null) {
      throw new AppError('user_account_inactive');
    }

    const usernameChanged =
      principal.username !== undefined && principal.username !== user.username;

    if (principal.email !== user.email || usernameChanged) {
      user = await this.userRepo.updateProfileById(user.id, {
        email: principal.email,
        ...(principal.username !== undefined ? { username: principal.username } : {}),
      });
    }

    return user;
  }
}
