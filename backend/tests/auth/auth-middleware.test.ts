import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { requireAuth } from '../../src/auth/auth-middleware.js';
import { verifyAccessToken } from '../../src/auth/access-token-verifier.js';
import { errorHandler } from '../../src/shared/validation/error-handler.js';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import request from 'supertest';
import { InvalidAccessTokenError } from '../../src/shared/errors/invalid-access-token-error.js';

vi.mock('../../src/auth/access-token-verifier.js', () => ({ verifyAccessToken: vi.fn() }));

const verifyAccessTokenMock = vi.mocked(verifyAccessToken);

function createTestApp() {
  const app = express();
  app.get('/protected', requireAuth, (req, res) => {
    res.status(200).json({
      principal: req.principal,
    });
  });

  app.use(errorHandler);

  return app;
}

describe('requireAuth', () => {
  beforeEach(() => {
    verifyAccessTokenMock.mockReset();
  });

  it('adds the authenticated principal to the request', async () => {
    const principal: AuthenticatedPrincipal = {
      issuer: 'http://localhost:8080/realms/zero-vault',
      subject: 'user-123',
      username: 'test',
    };
    verifyAccessTokenMock.mockResolvedValueOnce(principal);

    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ principal });
    expect(verifyAccessTokenMock).toHaveBeenCalledExactlyOnceWith('valid-token');
  });

  it('request without token returns unauthorized', async () => {
    const response = await request(createTestApp()).get('/protected');

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized', code: 'authentication_required' });
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing scheme', 'wrong'],
    ['wrong scheme', 'Basic some-token'],
    ['missing token', 'Bearer'],
    ['too many parts', 'Bearer token extra'],
  ])('request with %s return unauthorized', async (_case, authorization) => {
    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', authorization);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized', code: 'authentication_required' });
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it('request with invalid token rejected by the verifier', async () => {
    verifyAccessTokenMock.mockRejectedValueOnce(new InvalidAccessTokenError());

    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized', code: 'invalid_access_token' });
    expect(response.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    expect(verifyAccessTokenMock).toHaveBeenCalledExactlyOnceWith('invalid-token');
  });
});
