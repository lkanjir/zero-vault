import helmet from 'helmet';
import { oidcOrigin, storageOrigin } from './origins.js';
import type { RequestHandler, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

const CSP_NONCE_BYTES = 16;
const CSP_NONCE_LOCAL = 'cspNonce';

export const assignCspNonce: RequestHandler = (_req, res, next) => {
  res.locals[CSP_NONCE_LOCAL] = randomBytes(CSP_NONCE_BYTES).toString('base64');
  next();
};

export function getCspNonce(response: ServerResponse): string {
  const nonce: unknown = (response as Response).locals[CSP_NONCE_LOCAL];

  if (typeof nonce !== 'string') {
    throw new Error('CSP nonce is missing');
  }

  return nonce;
}

export const frontendCsp = helmet.contentSecurityPolicy({
  useDefaults: false,
  reportOnly: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", (_req, res) => `'nonce-${getCspNonce(res)}'`],
    styleSrc: [
      "'self'",
      'https://fonts.googleapis.com',
      (_req, res) => `'nonce-${getCspNonce(res)}'`,
    ],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:'],
    connectSrc: [
      "'self'",
      oidcOrigin,
      storageOrigin,
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
    ],
    frameSrc: [oidcOrigin],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    trustedTypes: ['angular', 'angular#builder'],
    requireTrustedTypesFor: ["'script'"],
  },
});
