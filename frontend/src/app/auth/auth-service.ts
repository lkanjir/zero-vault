import { Injectable, signal } from '@angular/core';
import Keycloak from 'keycloak-js';
import { loadRuntimeConfig } from './runtime-config';
import { UserProfile } from './user';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private keycloak: Keycloak | null = null;
  private readonly _userProfile = signal<UserProfile | null>(null);

  readonly authenticated = signal(false);
  readonly userProfile = this._userProfile.asReadonly();
  readonly accountUrl = signal<string>('');

  async initialize(): Promise<void> {
    const runtimeConfig = await loadRuntimeConfig();
    const keycloak = new Keycloak({
      url: runtimeConfig.auth.url,
      realm: runtimeConfig.auth.realm,
      clientId: runtimeConfig.auth.clientId,
    });
    this.keycloak = keycloak;

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

  async getAccessToken(): Promise<string> {
    const keycloak = this.requireKeycloak();
    await keycloak.updateToken(30);

    if (!keycloak.token) {
      throw new Error('Pristupni token nije dostupan');
    }

    return keycloak.token;
  }

  login(): Promise<void> {
    return this.requireKeycloak().login();
  }

  logout(): Promise<void> {
    return this.requireKeycloak().logout({ redirectUri: window.location.origin });
  }

  private requireKeycloak(): Keycloak {
    if (!this.keycloak) {
      throw new Error('Autentikacija nije inicijalizirana');
    }

    return this.keycloak;
  }

  private readUserProfile(keycloak: Keycloak): UserProfile {
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
