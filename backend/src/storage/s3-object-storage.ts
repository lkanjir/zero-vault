import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import type {
  ObjectMetadata,
  ObjectStorage,
  SignedDownloadUrlParams,
  SignedUploadUrlParams,
} from './object-storage.js';
import { headSchema } from './head-schema.js';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';
import { sha256Base64ToHex, sha256HexToBase64 } from '../shared/utils/sha256-convert.js';

export class S3ObjectStorage implements ObjectStorage {
  private readonly client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  async createPresignedUploadUrl(params: SignedUploadUrlParams): Promise<string> {
    const hashBase64 = sha256HexToBase64(params.sha256Hex);
    const command = new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: params.objectKey,
      ContentType: params.contentType,
      ChecksumSHA256: hashBase64,
      ChecksumAlgorithm: 'SHA256',
    });

    return getSignedUrl(this.client, command, { expiresIn: params.expiresInSeconds });
  }

  async headObject(objectKey: string): Promise<ObjectMetadata> {
    const command = new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey,
      ChecksumMode: 'ENABLED',
    });

    try {
      const response = await this.client.send(command);
      return this.mapToMetadata(objectKey, response);
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.name === 'NotFound' || error.$metadata.httpStatusCode === 404)
      ) {
        throw new NotFoundError('Upload object not found');
      }

      throw error;
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: objectKey });

    await this.client.send(command);
  }

  async createPresignedDownloadUrl(params: SignedDownloadUrlParams): Promise<string> {
    const contentDisposition = this.getDisposition(params.fileName);

    const command = new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: params.objectKey,
      ResponseContentType: params.contentType,
      ResponseContentDisposition: contentDisposition,
    });

    return getSignedUrl(this.client, command, { expiresIn: params.expiresInSeconds });
  }

  private mapToMetadata(key: string, response: HeadObjectCommandOutput): ObjectMetadata {
    const result = headSchema.safeParse(response);
    if (!result.success) {
      throw new Error('Invalid object metadata response', { cause: result.error });
    }

    const contentType = normalizedContentType(result.data.ContentType);
    const sha256Hex = result.data.ChecksumSHA256
      ? sha256Base64ToHex(result.data.ChecksumSHA256)
      : null;

    return {
      objectKey: key,
      sizeBytes: result.data.ContentLength,
      contentType: contentType,
      sha256Hex,
    };
  }

  private getDisposition(fileName: string): string {
    const encodedFileName = encodeURIComponent(fileName);
    return `attachment; filename*=UTF-8''${encodedFileName}`;
  }

  async deleteObjects(objectKeys: string[]): Promise<string[]> {
    if (objectKeys.length === 0) return [];

    const command = new DeleteObjectsCommand({
      Bucket: config.s3.bucket,
      Delete: {
        Objects: objectKeys.map((key) => ({
          Key: key,
        })),
        Quiet: true,
      },
    });

    const result = await this.client.send(command);
    return (result.Errors ?? []).flatMap((error) => {
      return error.Key ? [error.Key] : [];
    });
  }
}
