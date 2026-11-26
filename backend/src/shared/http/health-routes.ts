import express, { type Router } from 'express';

export function createHealthRouter(checkReadiness: () => Promise<void>): Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    try {
      await checkReadiness();
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Readiness check failed', { error });
      res.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
