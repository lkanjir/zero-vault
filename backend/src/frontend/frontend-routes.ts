import express, { Router, type RequestHandler } from 'express';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignCspNonce, frontendCsp, getCspNonce } from './csp.js';
import { readFile } from 'node:fs/promises';

const frontendRoot = fileURLToPath(
  new URL('../../../frontend/dist/frontend/browser/', import.meta.url),
);
const frontendIndexPath = join(frontendRoot, 'index.html');

const CSP_NONCE_PLACEHOLDER = '__CSP_NONCE__';
let frontendIndexTemplate: string | undefined;

async function getFrontendIndexTemplate(): Promise<string> {
  frontendIndexTemplate ??= await readFile(frontendIndexPath, 'utf-8');
  return frontendIndexTemplate;
}

const sendFrontend: RequestHandler = async (_req, res) => {
  const template = await getFrontendIndexTemplate();

  if (!template.includes(CSP_NONCE_PLACEHOLDER)) {
    throw new Error('Frontend index is missing the CSP nonce placeholder');
  }

  const document = template.replaceAll(CSP_NONCE_PLACEHOLDER, getCspNonce(res));

  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(document);
};

export function createFrontendRouter(): Router {
  const router = Router();

  router.use(assignCspNonce);
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
