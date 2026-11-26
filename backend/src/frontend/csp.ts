import helmet from 'helmet';
import type { RequestHandler, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

const CSP_NONCE_BYTES = 16;
const CSP_NONCE_LOCAL = 'cspNonce';

export type FrontendCspOrigins = {
  readonly oidcOrigin: string;
  readonly storageOrigin: string;
};

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

export function createFrontendCsp(origins: FrontendCspOrigins): RequestHandler {
  return helmet.contentSecurityPolicy({
    useDefaults: false,
    reportOnly: false,
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
        origins.oidcOrigin,
        origins.storageOrigin,
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
      ],
      frameSrc: [origins.oidcOrigin],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      trustedTypes: ['angular', 'angular#bundler'],
      requireTrustedTypesFor: ["'script'"],
    },
  });
}
