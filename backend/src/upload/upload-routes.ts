import express from 'express';
import { S3ObjectStorage } from '../s3-object-storage.js';
import { StorageService } from './upload-service.js';
import * as z from 'zod';
import { validateBody } from '../shared/validation/validate-body.js';

export const storageRouter = express.Router();

const s3 = new S3ObjectStorage();
const service = new StorageService(s3);

const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(2000),
  contentType: z.string().min(1).max(255),
});

storageRouter.post(
  '/presign',
  validateBody(uploadRequestSchema, async (_req, res, body) => {
    const result = await service.createUpload(body);
    res.status(201).json(result);
  }),
);
