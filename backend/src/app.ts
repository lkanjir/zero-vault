import express from 'express';
import { storageRouter } from './upload/upload-routes.js';
import { errorHandler } from './shared/validation/error-handler.js';
import { requireAuth } from './auth/auth-middleware.js';

export const app = express();

app.use('/uploads', requireAuth, express.json({ limit: '16kb' }), storageRouter);
app.use(errorHandler);
