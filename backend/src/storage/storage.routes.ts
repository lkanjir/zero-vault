import express from 'express';
import { S3ObjectStorage } from './S3ObjectStorage.js';
import { StorageService } from './StorageService.js';
import type { UploadUrlRequest } from './ObjectStorage.js';

export const storageRouter = express.Router()

const s3 = new S3ObjectStorage();
const service = new StorageService(s3);

storageRouter.post('/presign', async (req, res) => {
    const presignedUrl = await service.createUpload(req.body as UploadUrlRequest);
    res.status(201).json(presignedUrl);
})
