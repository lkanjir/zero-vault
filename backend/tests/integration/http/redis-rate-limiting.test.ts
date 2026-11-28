import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/auth/authenticated-principal.js';
import { createRedisClient, type RedisHandle } from '../../../src/redis/redis-client.js';
import { errorCatalog } from '../../../src/shared/errors/api/error-catalog.js';
import type { ErrorResponse } from '../../../src/shared/errors/api/error-response.js';
import { createRedisRateLimitStoreFactory } from '../../../src/shared/http/api-rate-limiters.js';
import { createAuthenticatedRateLimiter } from '../../../src/shared/http/authenticated-rate-limiter.js';
import { errorHandler } from '../../../src/shared/http/error-handler.js';
import { createHealthRouter } from '../../../src/shared/http/health-routes.js';
import { createIpRateLimiter } from '../../../src/shared/http/ip-rate-limiter.js';
import { requestContext } from '../../../src/shared/http/request-context.js';

const ISSUER = 'https://identity.example.test/realms/zero-vault';

describe('Redis-backed multi-instance rate limiting', () => {
  let container: StartedTestContainer;
  let redisA: RedisHandle;
  let redisB: RedisHandle;

  beforeAll(async () => {
    container = await new GenericContainer('redis:8.8.3-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--save', '', '--appendonly', 'no'])
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();

    const redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    redisA = createRedisClient({ url: redisUrl });
    redisB = createRedisClient({ url: redisUrl });

    await Promise.all([redisA.connect(), redisB.connect()]);
  });

  afterAll(async () => {
    await Promise.all([redisA.close(), redisB.close()]);
    await container.stop();
  });

  it('passes Redis readiness ping checks', async () => {
    await expect(redisA.checkConnection()).resolves.toBeUndefined();
    await expect(redisB.checkConnection()).resolves.toBeUndefined();
  });

  it('shares IP rate-limit counters across separate API instances via Redis', async () => {
    const namespace = `test-ip-${randomUUID()}`;
    const appA = createIpTestApp(redisA, namespace, 2);
    const appB = createIpTestApp(redisB, namespace, 2);

    const first = await request(appA).get('/api/config').set('X-Forwarded-For', '198.51.100.1');
    const second = await request(appB).get('/api/config').set('X-Forwarded-For', '198.51.100.1');
    const blockedOnA = await request(appA)
      .get('/api/config')
      .set('X-Forwarded-For', '198.51.100.1');
    const otherIpOnB = await request(appB)
      .get('/api/config')
      .set('X-Forwarded-For', '198.51.100.2');

    const body = blockedOnA.body as ErrorResponse;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(blockedOnA.status).toBe(429);
    expect(blockedOnA.headers['retry-after']).toBeDefined();
    expect(blockedOnA.headers['ratelimit-policy']).toContain('"api-ip"');
    expect(body).toStrictEqual({
      code: 'rate_limit_exceeded',
      message: errorCatalog.rate_limit_exceeded.message,
      requestId: blockedOnA.headers['x-request-id'],
    });
    expect(otherIpOnB.status).toBe(200);
  });

  it('shares per-principal counters across instances and isolates distinct limiter prefixes', async () => {
    const namespace = `test-auth-${randomUUID()}`;
    const appA = createAuthTestApp(redisA, namespace);
    const appB = createAuthTestApp(redisB, namespace);

    // Exhaust entry-read (limit 2) across instance A and instance B for user-1
    const read1 = await request(appA).get('/entries').set('X-Test-Subject', 'user-1');
    const read2 = await request(appB).get('/entries').set('X-Test-Subject', 'user-1');
    const readBlocked = await request(appA).get('/entries').set('X-Test-Subject', 'user-1');

    expect(read1.status).toBe(200);
    expect(read2.status).toBe(200);
    expect(readBlocked.status).toBe(429);
    expect(readBlocked.body).toStrictEqual({
      code: 'rate_limit_exceeded',
      message: errorCatalog.rate_limit_exceeded.message,
      requestId: readBlocked.headers['x-request-id'],
    });

    // Different principal on instance B is unaffected
    const otherUserRead = await request(appB).get('/entries').set('X-Test-Subject', 'user-2');
    expect(otherUserRead.status).toBe(200);

    // Same principal hitting a different limiter prefix (audit-read) does NOT collide with entry-read
    const audit1 = await request(appB).get('/audit').set('X-Test-Subject', 'user-1');
    const audit2 = await request(appA).get('/audit').set('X-Test-Subject', 'user-1');
    const auditBlocked = await request(appB).get('/audit').set('X-Test-Subject', 'user-1');

    expect(audit1.status).toBe(200);
    expect(audit2.status).toBe(200);
    expect(auditBlocked.status).toBe(429);
    expect(auditBlocked.headers['ratelimit-policy']).toContain('"audit-read"');
  });

  it('reloads rate-limit Lua scripts automatically after Redis SCRIPT FLUSH', async () => {
    const namespace = `test-noscript-${randomUUID()}`;
    const app = createIpTestApp(redisA, namespace, 2);

    const beforeFlush = await request(app)
      .get('/api/config')
      .set('X-Forwarded-For', '198.51.100.55');
    expect(beforeFlush.status).toBe(200);

    await redisA.sendCommand('SCRIPT', 'FLUSH');

    const afterFlush = await request(app)
      .get('/api/config')
      .set('X-Forwarded-For', '198.51.100.55');
    const blocked = await request(app).get('/api/config').set('X-Forwarded-For', '198.51.100.55');

    expect(afterFlush.status).toBe(200);
    expect(blocked.status).toBe(429);
  });

  it('fails fast with 503 on /ready and /api/* and closes cleanly when Redis becomes unavailable', async () => {
    const outageContainer = await new GenericContainer('redis:8.8.3-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--save', '', '--appendonly', 'no'])
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();

    const outageRedis = createRedisClient({
      url: `redis://${outageContainer.getHost()}:${outageContainer.getMappedPort(6379)}`,
    });
    await outageRedis.connect();

    const app = createIpTestApp(outageRedis, `test-outage-${randomUUID()}`, 5);

    const healthyReady = await request(app).get('/ready');
    const healthyApi = await request(app).get('/api/config').set('X-Forwarded-For', '198.51.100.9');
    expect(healthyReady.status).toBe(200);
    expect(healthyApi.status).toBe(200);

    await outageContainer.stop();

    const startedAt = Date.now();
    const failedReady = await request(app).get('/ready');
    const failedApi = await request(app).get('/api/config').set('X-Forwarded-For', '198.51.100.9');
    await outageRedis.close();
    const elapsedMs = Date.now() - startedAt;

    expect(failedReady.status).toBe(503);
    expect(failedReady.body).toStrictEqual({ status: 'unavailable' });
    expect(failedApi.status).toBe(503);
    expect(failedApi.body).toStrictEqual({
      code: 'service_unavailable',
      message: errorCatalog.service_unavailable.message,
      requestId: failedApi.headers['x-request-id'],
    });
    expect(elapsedMs).toBeLessThan(2_000);
  });
});

function createIpTestApp(redis: RedisHandle, namespace: string, limit: number): Express {
  const app = express();
  const storeFactory = createRedisRateLimitStoreFactory(redis, namespace);

  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(createHealthRouter(() => redis.checkConnection()));
  app.use(
    '/api',
    createIpRateLimiter({
      identifier: 'api-ip',
      windowMs: 60_000,
      limit,
      store: storeFactory('api-ip'),
    }),
  );
  app.get('/api/config', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);

  return app;
}

function createAuthTestApp(redis: RedisHandle, namespace: string): Express {
  const app = express();
  const storeFactory = createRedisRateLimitStoreFactory(redis, namespace);

  const entryReadLimiter = createAuthenticatedRateLimiter({
    identifier: 'entry-read',
    windowMs: 60_000,
    limit: 2,
    store: storeFactory('entry-read'),
  });
  const auditReadLimiter = createAuthenticatedRateLimiter({
    identifier: 'audit-read',
    windowMs: 60_000,
    limit: 2,
    store: storeFactory('audit-read'),
  });

  app.use(requestContext);
  app.use((req, _res, next) => {
    const principal: AuthenticatedPrincipal = {
      issuer: ISSUER,
      subject: req.get('X-Test-Subject') ?? 'default-user',
      email: 'test@example.test',
      firstName: 'Test',
      lastName: 'User',
    };
    req.principal = principal;
    next();
  });
  app.get('/entries', entryReadLimiter, (_req, res) => {
    res.status(200).json({ route: 'entries' });
  });
  app.get('/audit', auditReadLimiter, (_req, res) => {
    res.status(200).json({ route: 'audit' });
  });
  app.use(errorHandler);

  return app;
}
