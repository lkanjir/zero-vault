import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createAuditRouter } from '../../src/audit/audit-routes.js';
import type { AuditService } from '../../src/audit/audit-service.js';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import type { User } from '../../src/user/user.js';
import type { UserService } from '../../src/user/user-service.js';

const PRINCIPAL: AuthenticatedPrincipal = {
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'owner-subject',
  email: 'owner@example.com',
  firstName: 'Test',
  lastName: 'Owner',
};

const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  ...PRINCIPAL,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-01T10:00:00.000Z'),
  deletedAt: null,
};

describe('audit routes', () => {
  let userService: MockProxy<UserService>;
  let auditService: MockProxy<AuditService>;

  beforeEach(() => {
    userService = mock<UserService>();
    auditService = mock<AuditService>();
    userService.resolveUser.mockResolvedValue(USER);
    auditService.listEvents.mockResolvedValue({
      items: [],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
    auditService.getStatistics.mockResolvedValue({
      period: {
        from: '2026-07-10T12:00:00.000Z',
        to: '2026-08-09T12:00:00.000Z',
      },
      total: 0,
      entryChanges: 0,
      downloadRequests: 0,
      sharingChanges: 0,
    });
  });

  it('lists audit events using the default query contract', async () => {
    const response = await request(createTestApp(userService, auditService)).get('/audit/events');

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      items: [],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
    expect(userService.resolveUser).toHaveBeenCalledExactlyOnceWith(PRINCIPAL);
    expect(auditService.listEvents).toHaveBeenCalledExactlyOnceWith(USER, {
      cursor: null,
      limit: 50,
      search: null,
    });
  });

  it('normalizes audit cursor, limit and search query values', async () => {
    const response = await request(createTestApp(userService, auditService))
      .get('/audit/events')
      .query({ cursor: ' next-page ', limit: '25', search: ' Report ' });

    expect(response.status).toBe(200);
    expect(auditService.listEvents).toHaveBeenCalledExactlyOnceWith(USER, {
      cursor: 'next-page',
      limit: 25,
      search: 'Report',
    });
  });

  it('normalizes blank search to no search', async () => {
    const response = await request(createTestApp(userService, auditService))
      .get('/audit/events')
      .query({ search: '   ' });

    expect(response.status).toBe(200);
    expect(auditService.listEvents).toHaveBeenCalledExactlyOnceWith(USER, {
      cursor: null,
      limit: 50,
      search: null,
    });
  });

  it.each([
    ['a limit below the minimum', { limit: 0 }],
    ['a limit above the maximum', { limit: 101 }],
    ['an empty cursor', { cursor: '   ' }],
    ['an overlong search', { search: 'a'.repeat(501) }],
  ])('rejects %s before calling the audit service', async (_case, query) => {
    const response = await request(createTestApp(userService, auditService))
      .get('/audit/events')
      .query(query);
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body.code).toBe('invalid_request_query');
    expect(auditService.listEvents).not.toHaveBeenCalled();
  });

  it('maps an invalid decoded cursor through the API error contract', async () => {
    auditService.listEvents.mockRejectedValue(new AppError('invalid_cursor'));

    const response = await request(createTestApp(userService, auditService))
      .get('/audit/events')
      .query({ cursor: 'not-a-cursor' });
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body.code).toBe('invalid_cursor');
  });

  it('returns audit statistics for the authenticated application user', async () => {
    const response = await request(createTestApp(userService, auditService)).get(
      '/audit/statistics',
    );

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      period: {
        from: '2026-07-10T12:00:00.000Z',
        to: '2026-08-09T12:00:00.000Z',
      },
      total: 0,
      entryChanges: 0,
      downloadRequests: 0,
      sharingChanges: 0,
    });
    expect(auditService.getStatistics).toHaveBeenCalledExactlyOnceWith(USER);
  });
});

function createTestApp(userService: UserService, auditService: AuditService) {
  const app = express();

  app.use(requestContext);
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    next();
  });
  app.use('/audit', createAuditRouter({ userService, auditService }));
  app.use(errorHandler);

  return app;
}
