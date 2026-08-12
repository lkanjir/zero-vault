import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import { errorCatalog } from '../../src/shared/errors/api/error-catalog.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';
import { createAuthenticatedRateLimiter } from '../../src/shared/http/authenticated-rate-limiter.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';

const PRINCIPAL: AuthenticatedPrincipal = {
  issuer: 'https://identity.example.test/realms/zero-vault',
  subject: 'user-1',
  email: 'user@example.test',
  firstName: 'Test',
  lastName: 'User',
};

describe('authenticated rate limiter', () => {
  it('returns the API error contract and rate limit headers after the limit is exceeded', async () => {
    const handler = vi.fn<RequestHandler>((_req, res) => res.status(204).end());
    const app = createTestApp({ limit: 2, handler });

    const first = await request(app).post('/first');
    const second = await request(app).post('/first');
    const blocked = await request(app).post('/first');
    const body = blocked.body as ErrorResponse;

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(blocked.status).toBe(errorCatalog.rate_limit_exceeded.status);
    expect(body).toStrictEqual({
      code: 'rate_limit_exceeded',
      message: errorCatalog.rate_limit_exceeded.message,
      requestId: blocked.headers['x-request-id'],
    });
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['ratelimit']).toContain('test-policy');
    expect(blocked.headers['ratelimit-policy']).toContain('test-policy');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('keeps separate counters for different authenticated principals', async () => {
    const handler = vi.fn<RequestHandler>((_req, res) => res.status(204).end());
    const app = createTestApp({ limit: 1, handler });

    const firstUserResponse = await request(app).post('/first').set('X-Test-Subject', 'user-1');
    const secondUserResponse = await request(app).post('/first').set('X-Test-Subject', 'user-2');
    const firstUserBlocked = await request(app).post('/first').set('X-Test-Subject', 'user-1');

    expect(firstUserResponse.status).toBe(204);
    expect(secondUserResponse.status).toBe(204);
    expect(firstUserBlocked.status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('shares one counter when the same limiter instance protects multiple routes', async () => {
    const handler = vi.fn<RequestHandler>((_req, res) => res.status(204).end());
    const app = createTestApp({ limit: 1, handler });

    const first = await request(app).post('/first');
    const second = await request(app).post('/second');

    expect(first.status).toBe(204);
    expect(second.status).toBe(429);
    expect(handler).toHaveBeenCalledOnce();
  });
});

function createTestApp(options: { limit: number; handler: RequestHandler }): Express {
  const app = express();
  const limiter = createAuthenticatedRateLimiter({
    identifier: 'test-policy',
    windowMs: 60_000,
    limit: options.limit,
  });

  app.use(requestContext);
  app.use((req, _res, next) => {
    req.principal = {
      ...PRINCIPAL,
      subject: req.get('X-Test-Subject') ?? PRINCIPAL.subject,
    };
    next();
  });
  app.post('/first', limiter, options.handler);
  app.post('/second', limiter, options.handler);
  app.use(errorHandler);

  return app;
}
