import express from 'express';
import { storageRouter } from './upload/upload-routes.js';
import { errorHandler } from './shared/validation/error-handler.js';

export const app = express();

app.use(express.json({ limit: '16kb' }));
app.use('/uploads', storageRouter);
app.use(errorHandler);
