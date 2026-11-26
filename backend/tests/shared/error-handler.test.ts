import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import z from 'zod';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import { errorCatalog, type ErrorCode } from '../../src/shared/errors/api/error-catalog.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import { routeNotFound } from '../../src/shared/http/route-not-found.js';
import { validateRequest } from '../../src/shared/validation/validate-request.js';

const UNEXPECTED_ERROR = new Error('Sensitive database failure');
const PROVIDER_ERROR = new Error('Sensitive provider failure');

describe('HTTP error contract', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes AppError and applies catalog headers', async () => {
    const response = await request(createTestApp()).get('/invalid-token');

    expectErrorResponse(response, 'invalid_access_token');
    expect(response.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('returns invalid_json for malformed JSON', async () => {
    const response = await request(createTestApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expectErrorResponse(response, 'invalid_json');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns request_body_too_large when the JSON limit is exceeded', async () => {
    const response = await request(createTestApp())
      .post('/echo')
      .send({ value: 'a'.repeat(17 * 1024) });

    expectErrorResponse(response, 'request_body_too_large');
  });

  it('returns sanitized validation details', async () => {
    const response = await request(createTestApp()).post('/validated').send({ name: 'a' });
    const body = response.body as ErrorResponse;

    expectErrorResponse(response, 'invalid_request_body');
    expect(body.details?.issues).toHaveLength(1);
    expect(body.details?.issues[0]).toMatchObject({
      path: ['name'],
      code: 'too_small',
    });
    expect(typeof body.details?.issues[0]?.message).toBe('string');
    expect(body).not.toHaveProperty('details.issues.0.input');
  });

  it('normalizes unexpected errors without leaking their message', async () => {
    const response = await request(createTestApp())
      .get('/unexpected-error?search=sensitive-file-name')
      .set('Authorization', 'Bearer sensitive-access-token');

    expectErrorResponse(response, 'internal_server_error');
    expect(JSON.stringify(response.body)).not.toContain('Sensitive database failure');
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      'HTTP request failed',
      expect.objectContaining({
        requestId: response.headers['x-request-id'],
        method: 'GET',
        path: '/unexpected-error',
        status: 500,
        code: 'internal_server_error',
        error: UNEXPECTED_ERROR,
      }),
    );

    const serializedLog = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serializedLog).not.toContain('sensitive-file-name');
    expect(serializedLog).not.toContain('sensitive-access-token');
  });

  it('logs safe AppError context and the internal cause for infrastructure failures', async () => {
    const response = await request(createTestApp()).get('/provider-unavailable');

    expectErrorResponse(response, 'authentication_service_unavailable');
    expect(console.error).toHaveBeenCalledExactlyOnceWith('HTTP request failed', {
      requestId: response.headers['x-request-id'],
      method: 'GET',
      path: '/provider-unavailable',
      status: 503,
      code: 'authentication_service_unavailable',
      context: {
        providerOperation: 'fetch_jwks',
      },
      error: PROVIDER_ERROR,
    });
    expect(JSON.stringify(response.body)).not.toContain('Sensitive provider failure');
  });

  it('maps StorageError failures centrally to storage_unavailable without leaking details', async () => {
    const response = await request(createTestApp()).get('/storage-unavailable');

    expectErrorResponse(response, 'storage_unavailable');
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      'HTTP request failed',
      expect.objectContaining({
        requestId: response.headers['x-request-id'],
        method: 'GET',
        path: '/storage-unavailable',
        status: 503,
        code: 'storage_unavailable',
        context: {
          objectKey: 'users/u1/objects/obj-1',
          storageOperation: 'create_download_url',
        },
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('Sensitive storage failure');
  });

  it('returns the JSON contract for an unknown route', async () => {
    const response = await request(createTestApp()).get('/does-not-exist');

    expectErrorResponse(response, 'route_not_found');
  });
});

function createTestApp() {
  const app = express();

  app.use(requestContext);
  app.use(express.json({ limit: '16kb' }));
  app.post('/echo', (_req, res) => res.status(204).end());
  app.post(
    '/validated',
    validateRequest({ body: z.object({ name: z.string().min(3) }) }, (_req, res) => {
      res.status(204).end();
    }),
  );
  app.get('/invalid-token', () => {
    throw new AppError('invalid_access_token');
  });
  app.get('/unexpected-error', () => {
    throw UNEXPECTED_ERROR;
  });
  app.get('/provider-unavailable', () => {
    throw new AppError('authentication_service_unavailable', {
      cause: PROVIDER_ERROR,
      context: {
        providerOperation: 'fetch_jwks',
      },
    });
  });
  app.get('/storage-unavailable', () => {
    throw new StorageUnavailableError(
      {
        operation: 'create_download_url',
        objectKey: 'users/u1/objects/obj-1',
      },
      { cause: new Error('Sensitive storage failure') },
    );
  });
  app.use(routeNotFound);
  app.use(errorHandler);

  return app;
}

function expectErrorResponse(
  response: {
    status: number;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
  },
  code: ErrorCode,
): void {
  const requestId = response.headers['x-request-id'];
  const body = response.body as ErrorResponse;

  expect(response.status).toBe(errorCatalog[code].status);
  expect(typeof requestId).toBe('string');
  expect(body).toMatchObject({
    code,
    message: errorCatalog[code].message,
    requestId,
  });
}
