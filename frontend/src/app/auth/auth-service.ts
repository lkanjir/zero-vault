import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import Keycloak from 'keycloak-js';
import { AuthRuntimeConfig, loadRuntimeConfig, RuntimeConfig } from './runtime-config';
import { UserProfile } from './user';

export type KeycloakClient = Pick<
  Keycloak,
  | 'init'
  | 'updateToken'
  | 'login'
  | 'logout'
  | 'createAccountUrl'
  | 'token'
  | 'tokenParsed'
  | 'onAuthLogout'
  | 'onTokenExpired'
>;

export const RUNTIME_CONFIG_LOADER = new InjectionToken<() => Promise<RuntimeConfig>>(
  'RUNTIME_CONFIG_LOADER',
  {
    providedIn: 'root',
    factory: () => () => loadRuntimeConfig(),
  },
);

export const KEYCLOAK_CLIENT_FACTORY = new InjectionToken<
  (config: AuthRuntimeConfig) => KeycloakClient
>('KEYCLOAK_CLIENT_FACTORY', {
  providedIn: 'root',
  factory: () => (config) => new Keycloak(config),
});

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly loadConfig = inject(RUNTIME_CONFIG_LOADER);
  private readonly createKeycloak = inject(KEYCLOAK_CLIENT_FACTORY);

  private keycloak: KeycloakClient | null = null;
  private refreshTokenPromise: Promise<string> | null = null;
  private loginRedirectPromise: Promise<void> | null = null;
  private readonly _userProfile = signal<UserProfile | null>(null);

  readonly authenticated = signal(false);
  readonly userProfile = this._userProfile.asReadonly();
  readonly accountUrl = signal<string>('');

  async initialize(): Promise<void> {
    const runtimeConfig = await this.loadConfig();
    const keycloak = this.createKeycloak({
      url: runtimeConfig.auth.url,
      realm: runtimeConfig.auth.realm,
      clientId: runtimeConfig.auth.clientId,
    });
    this.keycloak = keycloak;

    keycloak.onAuthLogout = () => {
      this.clearSessionState();
    };
    keycloak.onTokenExpired = () => {
      void this.getAccessToken().catch(() => undefined);
    };

    const authenticated = await keycloak.init({
      onLoad: 'login-required',
      pkceMethod: 'S256',
    });

    this.accountUrl.set(keycloak.createAccountUrl());
    this.authenticated.set(authenticated);
    if (this.authenticated()) {
      this._userProfile.set(this.readUserProfile(keycloak));
    }
  }

  getAccessToken(): Promise<string> {
    if (this.refreshTokenPromise) {
      return this.refreshTokenPromise;
    }

    const request = this.refreshAccessToken().finally(() => {
      if (this.refreshTokenPromise === request) {
        this.refreshTokenPromise = null;
      }
    });

    this.refreshTokenPromise = request;
    return request;
  }

  login(): Promise<void> {
    if (this.loginRedirectPromise) {
      return this.loginRedirectPromise;
    }

    const redirect = this.requireKeycloak()
      .login()
      .finally(() => {
        if (this.loginRedirectPromise === redirect) {
          this.loginRedirectPromise = null;
        }
      });

    this.loginRedirectPromise = redirect;
    return redirect;
  }

  logout(): Promise<void> {
    this.clearSessionState();
    return this.requireKeycloak().logout({ redirectUri: window.location.origin });
  }

  private async refreshAccessToken(): Promise<string> {
    const keycloak = this.requireKeycloak();

    try {
      await keycloak.updateToken(30);
    } catch {
      this.handleExpiredSession();
      throw new Error('Sesija je istekla. Potrebna je ponovna prijava.');
    }

    if (!keycloak.token) {
      this.handleExpiredSession();
      throw new Error('Pristupni token nije dostupan.');
    }

    return keycloak.token;
  }

  private handleExpiredSession(): void {
    this.clearSessionState();
    void this.login().catch(() => undefined);
  }

  private clearSessionState(): void {
    this.authenticated.set(false);
    this._userProfile.set(null);
  }

  private requireKeycloak(): KeycloakClient {
    if (!this.keycloak) {
      throw new Error('Autentikacija nije inicijalizirana');
    }

    return this.keycloak;
  }

  private readUserProfile(keycloak: KeycloakClient): UserProfile {
    const firstName: unknown = keycloak.tokenParsed?.['given_name'];
    const lastName: unknown = keycloak.tokenParsed?.['family_name'];

    if (
      typeof firstName !== 'string' ||
      firstName.trim().length === 0 ||
      typeof lastName !== 'string' ||
      lastName.trim().length === 0
    ) {
      throw new Error('Podatci korisničkog profila nisu dostupni');
    }

    return {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };
  }
}
