import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthService,
  KEYCLOAK_CLIENT_FACTORY,
  KeycloakClient,
  RUNTIME_CONFIG_LOADER,
} from './auth-service';

describe('AuthService', () => {
  let keycloak: KeycloakClient & {
    init: ReturnType<typeof vi.fn>;
    updateToken: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    createAccountUrl: ReturnType<typeof vi.fn>;
  };
  let authService: AuthService;

  beforeEach(() => {
    keycloak = {
      init: vi.fn().mockResolvedValue(true),
      updateToken: vi.fn().mockResolvedValue(false),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      createAccountUrl: vi
        .fn()
        .mockReturnValue('https://auth.example.com/realms/zero-vault/account'),
      token: 'valid-token',
      tokenParsed: {
        given_name: 'Ana',
        family_name: 'Anić',
      },
      onAuthLogout: undefined,
      onTokenExpired: undefined,
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RUNTIME_CONFIG_LOADER,
          useValue: vi.fn().mockResolvedValue({
            auth: {
              url: 'https://auth.example.com',
              realm: 'zero-vault',
              clientId: 'zero-vault-web',
            },
          }),
        },
        {
          provide: KEYCLOAK_CLIENT_FACTORY,
          useValue: vi.fn().mockReturnValue(keycloak),
        },
      ],
    });

    authService = TestBed.inject(AuthService);
  });

  it('initializes Keycloak from runtime config and populates profile signals', async () => {
    await authService.initialize();

    expect(keycloak.init).toHaveBeenCalledWith({
      onLoad: 'login-required',
      pkceMethod: 'S256',
    });
    expect(authService.authenticated()).toBe(true);
    expect(authService.userProfile()).toStrictEqual({ firstName: 'Ana', lastName: 'Anić' });
    expect(authService.accountUrl()).toBe('https://auth.example.com/realms/zero-vault/account');
  });

  it('deduplicates concurrent getAccessToken refresh calls', async () => {
    await authService.initialize();
    let resolveRefresh!: (refreshed: boolean) => void;
    keycloak.updateToken.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const first = authService.getAccessToken();
    const second = authService.getAccessToken();
    resolveRefresh(true);

    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      'valid-token',
      'valid-token',
    ]);
    expect(keycloak.updateToken).toHaveBeenCalledTimes(1);
  });

  it('clears session state and redirects to login when refresh token update fails', async () => {
    await authService.initialize();
    keycloak.updateToken.mockRejectedValueOnce(new Error('invalid_grant'));

    await expect(authService.getAccessToken()).rejects.toThrow(
      'Sesija je istekla. Potrebna je ponovna prijava.',
    );

    expect(authService.authenticated()).toBe(false);
    expect(authService.userProfile()).toBeNull();
    expect(keycloak.login).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent login redirects when multiple refresh failures overlap', async () => {
    await authService.initialize();
    let resolveLogin!: () => void;
    keycloak.login.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );

    const first = authService.login();
    const second = authService.login();
    resolveLogin();

    await Promise.all([first, second]);
    expect(keycloak.login).toHaveBeenCalledTimes(1);
  });
});
