import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadApiConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/db-client.js';
import type { RedisHandle } from '../../src/redis/redis-client.js';
import { errorCatalog } from '../../src/shared/errors/api/error-catalog.js';
import { createApiRateLimiters } from '../../src/shared/http/api-rate-limiters.js';
import { createIpRateLimiter } from '../../src/shared/http/ip-rate-limiter.js';

function createFakeRedis(overrides: Partial<RedisHandle> = {}): RedisHandle {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn(),
    checkConnection: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('upload authentication', () => {
  const apiConfig = loadApiConfig();
  const database = createDatabase(apiConfig.db);
  const app = createApp({
    config: apiConfig,
    database,
    redis: createFakeRedis(),
    rateLimiters: createApiRateLimiters(),
  });

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
      redis: createFakeRedis(),
      rateLimiters: createApiRateLimiters(),
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
      redis: createFakeRedis(),
      rateLimiters: createApiRateLimiters(),
    });

    expect(proxiedApp.get('trust proxy')).toBe(1);
  });

  it('checks both database and Redis in /ready', async () => {
    const checkDb = vi.fn().mockResolvedValue(undefined);
    const checkRedis = vi.fn().mockResolvedValue(undefined);
    const fakeRedis = createFakeRedis({ checkConnection: checkRedis });
    const readyApp = createApp({
      config: apiConfig,
      database: {
        ...database,
        checkConnection: checkDb,
      },
      redis: fakeRedis,
      rateLimiters: createApiRateLimiters(),
    });

    const okResponse = await request(readyApp).get('/ready');
    expect(okResponse.status).toBe(200);
    expect(okResponse.body).toStrictEqual({ status: 'ok' });
    expect(checkDb).toHaveBeenCalledOnce();
    expect(checkRedis).toHaveBeenCalledOnce();

    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    checkRedis.mockRejectedValueOnce(new Error('redis unavailable'));

    const failedResponse = await request(readyApp).get('/ready');
    expect(failedResponse.status).toBe(503);
    expect(failedResponse.body).toStrictEqual({ status: 'unavailable' });
  });

  it('wires Redis-backed rate limiters by default when custom rateLimiters are not provided', async () => {
    const sendCommand = vi.fn((command: string) => {
      if (command === 'SCRIPT') {
        return Promise.resolve('fake-script-sha');
      }

      return Promise.resolve([1, 60_000]);
    });
    const redisBackedApp = createApp({
      config: apiConfig,
      database,
      redis: createFakeRedis({ sendCommand }),
    });

    const response = await request(redisBackedApp).get('/api/config');

    expect(response.status).toBe(200);
    expect(sendCommand).toHaveBeenCalledWith(
      'EVALSHA',
      'fake-script-sha',
      '1',
      expect.stringMatching(/^zv:rl:api-ip:/),
      '60000',
    );
  });

  it('enforces the global IP rate limiter before /api/config and JWT authentication', async () => {
    const rateLimiters = {
      ...createApiRateLimiters(),
      globalIpRateLimiter: createIpRateLimiter({
        identifier: 'api-ip',
        windowMs: 60_000,
        limit: 2,
      }),
    };
    const limitedApp = createApp({
      config: {
        ...apiConfig,
        http: {
          ...apiConfig.http,
          trustProxy: 1,
        },
      },
      database,
      redis: createFakeRedis(),
      rateLimiters,
    });

    const first = await request(limitedApp)
      .get('/api/config')
      .set('X-Forwarded-For', '203.0.113.10');
    const second = await request(limitedApp)
      .post('/api/uploads/presign')
      .set('X-Forwarded-For', '203.0.113.10');
    const blocked = await request(limitedApp)
      .post('/api/uploads/presign')
      .set('X-Forwarded-For', '203.0.113.10');
    const otherClient = await request(limitedApp)
      .get('/api/config')
      .set('X-Forwarded-For', '203.0.113.11');

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body).toStrictEqual({
      code: 'rate_limit_exceeded',
      message: errorCatalog.rate_limit_exceeded.message,
      requestId: blocked.headers['x-request-id'],
    });
    expect(otherClient.status).toBe(200);
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
