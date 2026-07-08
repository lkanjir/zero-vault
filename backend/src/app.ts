import express from 'express';
import { errorHandler } from './shared/validation/error-handler.js';
import { requireAuth } from './auth/auth-middleware.js';
import { createCompositionRoot } from './composition-root.js';
import { createUploadRouter } from './upload/upload-routes.js';

export const app = express();
const composition = createCompositionRoot();

app.use(express.json({ limit: '16kb' }));

app.use('/uploads', requireAuth, createUploadRouter(composition));

app.use(errorHandler);
