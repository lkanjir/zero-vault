import { Injectable, signal } from '@angular/core';
import Keycloak from 'keycloak-js';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly keycloak = new Keycloak({
    url: environment.auth.url,
    realm: environment.auth.realm,
    clientId: environment.auth.clientId,
  });

  readonly authenitcated = signal(false);

  async initialize(): Promise<void> {
    const authenitcated = await this.keycloak.init({
      onLoad: 'login-required',
      pkceMethod: 'S256',
    });

    this.authenitcated.set(authenitcated);
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
}
