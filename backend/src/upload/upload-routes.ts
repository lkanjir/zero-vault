import express from 'express';
import { S3ObjectStorage } from '../storage/s3-object-storage.js';
import { UploadService } from './upload-service.js';
import { validateBody } from '../shared/validation/validate-body.js';
import { completeUploadSchema, uploadRequestSchema } from './validation-schemas.js';
import { PostgresIntentRepository } from './postgres-intent-repository.js';
import { validateParams } from '../shared/validation/validate-params.js';

export const storageRouter = express.Router();

const s3 = new S3ObjectStorage();
const intentRepository = new PostgresIntentRepository();
const service = new UploadService(s3, intentRepository);

storageRouter.post(
  '/presign',
  validateBody(uploadRequestSchema, async (_req, res, body) => {
    const result = await service.createUpload(body);
    res.status(201).json(result);
  }),
);

storageRouter.post(
  '/:uploadId/complete',
  validateParams(completeUploadSchema, async (_req, res, params) => {
    const result = await service.completeUpload(params.uploadId);
    res.status(200).json(result);
  }),
);
