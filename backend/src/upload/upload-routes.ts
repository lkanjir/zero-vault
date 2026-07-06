import express from 'express';
import { S3ObjectStorage } from '../storage/s3-object-storage.js';
import { UploadService } from './upload-service.js';
import { validateBody } from '../shared/validation/validate-body.js';
import { completeUploadSchema, uploadRequestSchema } from './validation-schemas.js';
import { PostgresIntentRepository } from './postgres-intent-repository.js';
import { validateParams } from '../shared/validation/validate-params.js';
import { requirePrincipal } from '../auth/require-principal.js';
import { UserService } from '../user/user-service.js';
import { PostgresUserRepository } from '../user/postgres-user-repository.js';

export const storageRouter = express.Router();

const s3 = new S3ObjectStorage();
const intentRepository = new PostgresIntentRepository();
const uploadService = new UploadService(s3, intentRepository);
const userRepo = new PostgresUserRepository();
const userService = new UserService(userRepo);

storageRouter.post(
  '/presign',
  validateBody(uploadRequestSchema, async (req, res, body) => {
    const principal = requirePrincipal(req);
    const authenticatedUser = await userService.resolveUser(principal);

    const result = await uploadService.createUpload(authenticatedUser, body);
    res.status(201).json(result);
  }),
);

storageRouter.post(
  '/:uploadId/complete',
  validateParams(completeUploadSchema, async (req, res, params) => {
    const principal = requirePrincipal(req);
    const authenticatedUser = await userService.resolveUser(principal);

    const result = await uploadService.completeUpload(authenticatedUser, params.uploadId);
    res.status(200).json(result);
  }),
);
