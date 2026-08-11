import express, { Router, type RequestHandler } from 'express';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(
  new URL('../../../frontend/dist/frontend/browser/', import.meta.url),
);

const sendFrontend: RequestHandler = (_req, res) => {
  res.sendFile('index.html', { root: frontendRoot });
};

export function createFrontendRouter(): Router {
  const router = Router();

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
