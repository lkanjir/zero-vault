import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';

describe('upload authentication', () => {
  it('upload route requires authentication', async () => {
    const response = await request(app).get('/uploads/presign');

    const body = response.body as { error: string; code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe('authentication_required');
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });
});
