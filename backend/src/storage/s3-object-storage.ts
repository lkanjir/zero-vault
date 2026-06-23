import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import type { ObjectMetadata, ObjectStorage, SignedUrlParams } from './object-storage.js';
import { headSchema } from './head-schema.js';

export class S3ObjectStorage implements ObjectStorage {
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

  async headObject(objectKey: string): Promise<ObjectMetadata> {
    const command = new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey,
    });

    const response = await this.client.send(command);
    return this.mapToMetadata(objectKey, response);
  }

  private mapToMetadata(key: string, response: HeadObjectCommandOutput): ObjectMetadata {
    const result = headSchema.safeParse({ key, ...response });
    if (!result.success) {
      console.error(result.error);
      throw new Error('Metadata mapping error');
    }

    return {
      objectKey: result.data.objectKey,
      size: result.data.size,
      contentType: result.data.contentType,
      etag: result.data.etag,
    };
  }
}
