import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { requireAuth } from '../src/auth/auth-middleware.js';
import { verifyAccessToken } from '../src/auth/access-token-verifier.js';
import { errorHandler } from '../src/shared/validation/error-handler.js';
import type { AuthenticatedPrincipal } from '../src/auth/authenticated-principal.js';
import request from 'supertest';

vi.mock('../src/auth/access-token-verifier.js', () => ({ verifyAccessToken: vi.fn() }));

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
});
