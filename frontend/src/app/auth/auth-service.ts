import { Injectable, signal } from '@angular/core';
import Keycloak from 'keycloak-js';
import { environment } from '../../environments/environment';
import { UserProfile } from './user';
import { first } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly keycloak = new Keycloak({
    url: environment.auth.url,
    realm: environment.auth.realm,
    clientId: environment.auth.clientId,
  });
  private readonly _userProfile = signal<UserProfile | null>(null);

  readonly authenitcated = signal(false);
  readonly userProfile = this._userProfile.asReadonly();

  async initialize(): Promise<void> {
    const authenitcated = await this.keycloak.init({
      onLoad: 'login-required',
      pkceMethod: 'S256',
    });

    this.authenitcated.set(authenitcated);
    if (this.authenitcated()) {
      this._userProfile.set(this.readUserProfile());
    }
  }

  async getAccessToken(): Promise<string> {
    await this.keycloak.updateToken(30);

    if (!this.keycloak.token) {
      throw new Error('Pristupni token nije dostupan');
    }

    return this.keycloak.token;
  }

  login(): Promise<void> {
    return this.keycloak.login();
  }

  logout(): Promise<void> {
    return this.keycloak.logout({ redirectUri: window.location.origin });
  }

  private readUserProfile(): UserProfile {
    const firstName: unknown = this.keycloak.tokenParsed?.['given_name'];
    const lastName: unknown = this.keycloak.tokenParsed?.['family_name'];

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
