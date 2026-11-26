import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHealthRouter } from '../../src/shared/http/health-routes.js';

describe('health routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 ok with no-store on /health without checking readiness dependencies', async () => {
    const checkReadiness = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(createHealthRouter(checkReadiness));

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toStrictEqual({ status: 'ok' });
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it('returns 200 ok with no-store on /ready when dependencies are ready', async () => {
    const checkReadiness = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(createHealthRouter(checkReadiness));

    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toStrictEqual({ status: 'ok' });
    expect(checkReadiness).toHaveBeenCalledOnce();
  });

  it('returns 503 unavailable with no-store on /ready when readiness fails', async () => {
    const checkReadiness = vi.fn().mockRejectedValue(new Error('database down'));
    const app = express();
    app.use(createHealthRouter(checkReadiness));

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toStrictEqual({ status: 'unavailable' });
    expect(console.error).toHaveBeenCalledOnce();
  });
});
