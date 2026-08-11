import express, { Router, type RequestHandler } from 'express';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import helmet from 'helmet';

const frontendRoot = fileURLToPath(
  new URL('../../../frontend/dist/frontend/browser/', import.meta.url),
);

const sendFrontend: RequestHandler = (_req, res) => {
  res.sendFile('index.html', { root: frontendRoot });
};

const oidcOrigin = new URL(config.oidc.issuer).origin;
const storageOrigin = new URL(config.s3.endpoint).origin;

const frontendCsp = helmet.contentSecurityPolicy({
  useDefaults: false,
  reportOnly: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", 'https://fonts.googleapis.com'],
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
  },
});

export function createFrontendRouter(): Router {
  const router = Router();

  router.use(frontendCsp);

  router.get(['/', '/index.html'], sendFrontend);
  router.use(express.static(frontendRoot, { index: false, redirect: false }));

  router.get('/{*path}', (req, res, next) => {
    const hasFileExtension = extname(req.path) !== '';
    const acceptsHtml = req.accepts('html') !== false;

    if (hasFileExtension || !acceptsHtml) {
      next();
      return;
    }

    sendFrontend(req, res, next);
  });

  return router;
}
