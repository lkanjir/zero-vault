import express from 'express';
import { S3ObjectStorage } from '../storage/s3-object-storage.js';
import { StorageService } from './upload-service.js';
import { validateBody } from '../shared/validation/validate-body.js';
import { uploadRequestSchema } from './upload-schema.js';
import { UploadIntentRepository } from './upload-intent-repository.js';

export const storageRouter = express.Router();

const s3 = new S3ObjectStorage();
const intentRepository = new UploadIntentRepository();
const service = new StorageService(s3, intentRepository);

storageRouter.post(
  '/presign',
  validateBody(uploadRequestSchema, async (_req, res, body) => {
    const result = await service.createUpload(body);
    res.status(201).json(result);
  }),
);
