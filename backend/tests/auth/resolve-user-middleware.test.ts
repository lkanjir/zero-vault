import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import {
  createResolveUserMiddleware,
  requireUser,
} from '../../src/auth/resolve-user-middleware.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import type { User } from '../../src/user/user.js';
import type { UserService } from '../../src/user/user-service.js';

const PRINCIPAL: AuthenticatedPrincipal = {
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
};

const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  ...PRINCIPAL,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
};

describe('resolve user middleware', () => {
  it('resolves the application user from req.principal and attaches it to req.user', async () => {
    const userService = mock<UserService>();
    userService.resolveUser.mockResolvedValue(USER);

    const app = express();
    app.use(requestContext);
    app.use((req, _res, next) => {
      req.principal = PRINCIPAL;
      next();
    });
    app.use(createResolveUserMiddleware(userService));
    app.get('/me', (req, res) => {
      res.status(200).json({ publicId: requireUser(req).publicId });
    });
    app.use(errorHandler);

    const response = await request(app).get('/me');

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ publicId: USER.publicId });
    expect(userService.resolveUser).toHaveBeenCalledExactlyOnceWith(PRINCIPAL);
  });

  it('forwards application errors from UserService to the error handler', async () => {
    const userService = mock<UserService>();
    userService.resolveUser.mockRejectedValue(new AppError('user_account_inactive'));

    const app = express();
    app.use(requestContext);
    app.use((req, _res, next) => {
      req.principal = PRINCIPAL;
      next();
    });
    app.use(createResolveUserMiddleware(userService));
    app.get('/me', (_req, res) => {
      res.status(200).end();
    });
    app.use(errorHandler);

    const response = await request(app).get('/me');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'user_account_inactive' });
  });

  it('throws when req.user is accessed without the middleware', () => {
    expect(() => requireUser({} as express.Request)).toThrow('Missing resolved application user');
  });
});
