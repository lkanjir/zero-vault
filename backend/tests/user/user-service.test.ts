import { describe, expect, it, beforeEach } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { UserRepository } from '../../src/user/user-repository.js';
import type { User } from '../../src/user/user.js';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import { UserService } from '../../src/user/user-service.js';

const existingUser: User = {
  id: 1,
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'existing_user',
  username: 'test',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const principal: AuthenticatedPrincipal = {
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'existing_user',
  username: 'test',
};

describe('resolveUser', () => {
  let repo: MockProxy<UserRepository>;
  let service: UserService;

  beforeEach(() => {
    repo = mock<UserRepository>();
    service = new UserService(repo);
  });

  it('existing user does not call create', async () => {
    repo.findByPrincipal.calledWith(principal).mockResolvedValue(existingUser);

    const user = await service.resolveUser(principal);

    expect(user).toStrictEqual(existingUser);
    expect(repo.createFromPrincipal).not.toHaveBeenCalled();
    expect(repo.updateUsernameById).not.toHaveBeenCalled();
    expect(repo.findByPrincipal).toHaveBeenCalledExactlyOnceWith(principal);
  });

  it('if user does not exist the user is created', async () => {
    repo.findByPrincipal.calledWith(principal).mockResolvedValue(null);
    repo.createFromPrincipal.calledWith(principal).mockResolvedValue(existingUser);

    const user = await service.resolveUser(principal);

    expect(user).toStrictEqual(existingUser);
    expect(repo.createFromPrincipal).toHaveBeenCalledExactlyOnceWith(principal);
    expect(repo.updateUsernameById).not.toHaveBeenCalled();
    expect(repo.findByPrincipal).toHaveBeenCalledExactlyOnceWith(principal);
  });

  it('updates a changed username', async () => {
    const principalWithNewName: AuthenticatedPrincipal = {
      ...principal,
      username: 'new',
    };

    const userWithNewName: User = {
      ...existingUser,
      username: 'new',
    };

    repo.findByPrincipal.calledWith(principalWithNewName).mockResolvedValue(existingUser);
    repo.updateUsernameById
      .calledWith(existingUser.id, principalWithNewName.username!)
      .mockResolvedValue(userWithNewName);

    const user = await service.resolveUser(principalWithNewName);

    expect(user).toStrictEqual(userWithNewName);
    expect(repo.createFromPrincipal).not.toHaveBeenCalled();
    expect(repo.updateUsernameById).toHaveBeenCalledExactlyOnceWith(existingUser.id, 'new');
    expect(repo.findByPrincipal).toHaveBeenCalledExactlyOnceWith(principalWithNewName);
  });

  it('principal without username preserves the existing username', async () => {
    const principalWithoutUsername: AuthenticatedPrincipal = {
      issuer: principal.issuer,
      subject: principal.subject,
    };

    repo.findByPrincipal.calledWith(principalWithoutUsername).mockResolvedValue(existingUser);

    const user = await service.resolveUser(principalWithoutUsername);

    expect(user).toStrictEqual(existingUser);
    expect(repo.createFromPrincipal).not.toHaveBeenCalled();
    expect(repo.updateUsernameById).not.toHaveBeenCalled();
    expect(repo.findByPrincipal).toHaveBeenCalledExactlyOnceWith(principalWithoutUsername);
  });

  it('finds user after another request creates it first', async () => {
    repo.findByPrincipal.mockResolvedValueOnce(null).mockResolvedValueOnce(existingUser);
    repo.createFromPrincipal.mockResolvedValueOnce(null);

    const result = await service.resolveUser(principal);

    expect(result).toStrictEqual(existingUser);

    expect(repo.findByPrincipal).toHaveBeenCalledTimes(2);
    expect(repo.findByPrincipal).toHaveBeenNthCalledWith(1, principal);
    expect(repo.findByPrincipal).toHaveBeenNthCalledWith(2, principal);

    expect(repo.createFromPrincipal).toHaveBeenCalledExactlyOnceWith(principal);
    expect(repo.updateUsernameById).not.toHaveBeenCalled();
  });
});
