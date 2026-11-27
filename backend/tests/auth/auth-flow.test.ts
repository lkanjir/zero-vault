import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadApiConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/db-client.js';

describe('upload authentication', () => {
  const apiConfig = loadApiConfig();
  const database = createDatabase(apiConfig.db);
  const app = createApp({ config: apiConfig, database });

  afterAll(async () => {
    await database.close();
  });

  it('upload route requires authentication', async () => {
    const response = await request(app).post('/api/uploads/presign');

    const body = response.body as { code: string; message: string; requestId: string };

    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.code).toBe('authentication_required');
    expect(body.message).toBe('Potrebna je prijava.');
    expect(body.requestId).toBe(response.headers['x-request-id']);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('serves /health without authentication', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toStrictEqual({ status: 'ok' });
  });

  it('serves /api/config without authentication', async () => {
    const response = await request(app).get('/api/config');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toStrictEqual({
      auth: {
        url: apiConfig.oidc.url,
        realm: apiConfig.oidc.realm,
        clientId: apiConfig.oidc.clientId,
      },
    });
  });

  it('sets Strict-Transport-Security only when HSTS is enabled', async () => {
    const withoutHsts = await request(app).get('/health');
    expect(withoutHsts.headers['strict-transport-security']).toBeUndefined();

    const hstsApp = createApp({
      config: {
        ...apiConfig,
        http: {
          ...apiConfig.http,
          hstsEnabled: true,
        },
      },
      database,
    });

    const withHsts = await request(hstsApp).get('/health');
    expect(withHsts.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('configures Express trust proxy from HTTP config', () => {
    expect(app.get('trust proxy')).toBe(false);

    const proxiedApp = createApp({
      config: {
        ...apiConfig,
        http: {
          ...apiConfig.http,
          trustProxy: 1,
        },
      },
      database,
    });

    expect(proxiedApp.get('trust proxy')).toBe(1);
  });

  it('enforces Keycloak realm security hardening invariants', () => {
    const realmPath = fileURLToPath(
      new URL('../../../keycloak/realm/zero-vault-realm.json', import.meta.url),
    );
    const realm = JSON.parse(readFileSync(realmPath, 'utf-8')) as {
      revokeRefreshToken: boolean;
      refreshTokenMaxReuse: number;
      failureFactor: number;
      registrationAllowed: boolean;
      verifyEmail: boolean;
      bruteForceProtected: boolean;
      roles: {
        realm: Array<{ name: string; composites?: { realm?: string[] } }>;
      };
      clients: Array<{
        clientId: string;
        defaultClientScopes?: string[];
        optionalClientScopes?: string[];
        attributes?: Record<string, string>;
      }>;
    };

    expect(realm.revokeRefreshToken).toBe(true);
    expect(realm.refreshTokenMaxReuse).toBe(0);
    expect(realm.bruteForceProtected).toBe(true);
    expect(realm.failureFactor).toBeGreaterThanOrEqual(5);
    expect(realm.failureFactor).toBeLessThanOrEqual(10);
    expect(realm.registrationAllowed).toBe(true);
    expect(realm.verifyEmail).toBe(true);

    const defaultRole = realm.roles.realm.find((role) => role.name === 'default-roles-zero-vault');
    expect(defaultRole?.composites?.realm).not.toContain('offline_access');

    const webClient = realm.clients.find((client) => client.clientId === 'zero-vault-web');
    expect(webClient?.attributes?.['pkce.code.challenge.method']).toBe('S256');
    expect(webClient?.defaultClientScopes).not.toContain('offline_access');
    expect(webClient?.optionalClientScopes).not.toContain('offline_access');
  });
});
