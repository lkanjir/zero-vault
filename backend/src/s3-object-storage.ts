import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';
import type { SignedUrlParams } from './upload/object-storage.js';

export class S3ObjectStorage {
  private readonly client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.s3.accessKey,
      secretAccessKey: config.s3.secretKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  async createPresignedUrl(params: SignedUrlParams): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: params.objectKey,
      ContentType: params.contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: params.expiresInSeconds });
  }
}
