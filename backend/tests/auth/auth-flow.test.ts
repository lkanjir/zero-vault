import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';

describe('upload authentication', () => {
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
});
