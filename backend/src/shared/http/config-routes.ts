import express, { type Router } from 'express';
import type { OidcConfig } from '../../config.js';

export type PublicAuthConfig = Pick<OidcConfig, 'url' | 'realm' | 'clientId'>;

export function createPublicConfigRouter(authConfig: PublicAuthConfig): Router {
  const router = express.Router();

  router.get('/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      auth: {
        url: authConfig.url,
        realm: authConfig.realm,
        clientId: authConfig.clientId,
      },
    });
  });

  return router;
}
