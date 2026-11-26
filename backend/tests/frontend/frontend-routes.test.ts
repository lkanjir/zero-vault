import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const CSP_NONCE_PLACEHOLDER = '__CSP_NONCE__';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(`<!doctype html>
    <html>
      <body>
        <app-root ngCspNonce="__CSP_NONCE__"></app-root>
        <script nonce="__CSP_NONCE__" src="main.js"></script>
      </body>
    </html>`),
}));

import { createFrontendRouter } from '../../src/frontend/frontend-routes.js';

describe('frontend routes', () => {
  it('serves HTML with an enforced nonce-based CSP and a fresh nonce per response', async () => {
    const app = express();
    app.use(
      createFrontendRouter({
        oidcOrigin: 'http://localhost:8080',
        storageOrigin: 'http://localhost:4566',
      }),
    );

    const first = await request(app).get('/').set('Accept', 'text/html');
    const second = await request(app).get('/drive/folder').set('Accept', 'text/html');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['content-security-policy-report-only']).toBeUndefined();
    expect(first.text).not.toContain(CSP_NONCE_PLACEHOLDER);

    const firstNonce = extractNonce(first.text);
    const secondNonce = extractNonce(second.text);
    const policy = first.headers['content-security-policy'];

    expect(firstNonce).not.toBe(secondNonce);
    expect(first.text.split(firstNonce)).toHaveLength(3);
    expect(policy).toContain(`script-src 'self' 'nonce-${firstNonce}'`);
    expect(policy).toContain(`style-src 'self' https://fonts.googleapis.com 'nonce-${firstNonce}'`);
    expect(policy).toContain('connect-src');
    expect(policy).toContain('http://localhost:8080');
    expect(policy).toContain('http://localhost:4566');
    expect(policy).toContain('trusted-types angular angular#bundler');
    expect(policy).toContain("require-trusted-types-for 'script'");
  });
});

function extractNonce(document: string): string {
  const nonce = /ngCspNonce="([^"]+)"/.exec(document)?.[1];

  expect(nonce).toBeDefined();
  return nonce!;
}
