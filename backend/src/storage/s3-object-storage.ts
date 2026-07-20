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
  UploadObjectStreamParams,
} from './object-storage.js';
import { headSchema } from './head-schema.js';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';
import { sha256Base64ToHex, sha256HexToBase64 } from '../shared/utils/sha256-convert.js';
import { StorageError, type StorageErrorContext } from '../shared/errors/storage/storage-error.js';
import { StorageUnavailableError } from '../shared/errors/storage/storage-unavailable-error.js';
import { StorageObjectNotFoundError } from '../shared/errors/storage/storage-object-not-found-error.js';
import { Readable } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';

const MULTIPART_PART_SIZE_BYTES = 32 * 1024 * 1024;
const MULTIPART_QUEUE_SIZE = 2;

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

  private async executeStorageOperation<T>(
    context: StorageErrorContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const isObjectReadOperation =
        context.operation === 'head_object' || context.operation === 'get_object_stream';

      if (error instanceof StorageError) {
        throw error;
      }

      if (isObjectReadOperation && this.isObjectNotFoundError(error)) {
        throw new StorageObjectNotFoundError(context, { cause: error });
      }

      throw new StorageUnavailableError(context, { cause: error });
    }
  }

  private isObjectNotFoundError(error: unknown): boolean {
    return (
      error instanceof S3ServiceException &&
      (error.name === 'NotFound' || error.$metadata.httpStatusCode === 404)
    );
  }

  async createPresignedUploadUrl(params: SignedUploadUrlParams): Promise<string> {
    const context = {
      operation: 'create_upload_url',
      objectKey: params.objectKey,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(context, async () => {
      const hashBase64 = sha256HexToBase64(params.sha256Hex);
      const command = new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: params.objectKey,
        ContentType: params.contentType,
        ChecksumSHA256: hashBase64,
        ChecksumAlgorithm: 'SHA256',
      });

      return getSignedUrl(this.client, command, { expiresIn: params.expiresInSeconds });
    });
  }

  async headObject(objectKey: string): Promise<ObjectMetadata> {
    const context = {
      operation: 'head_object',
      objectKey,
    } as const satisfies StorageErrorContext;

    const command = new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey,
      ChecksumMode: 'ENABLED',
    });

    return this.executeStorageOperation(context, async () => {
      const response = await this.client.send(command);
      return this.mapToMetadata(objectKey, context, response);
    });
  }

  async deleteObject(objectKey: string): Promise<void> {
    const context = {
      operation: 'delete_object',
      objectKey,
    } as const satisfies StorageErrorContext;

    await this.executeStorageOperation(context, async () => {
      const command = new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: objectKey });
      await this.client.send(command);
    });
  }

  async createPresignedDownloadUrl(params: SignedDownloadUrlParams): Promise<string> {
    const contentDisposition = this.getDisposition(params.fileName);

    const context = {
      operation: 'create_download_url',
      objectKey: params.objectKey,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(context, async () => {
      const command = new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: params.objectKey,
        ResponseContentType: params.contentType,
        ResponseContentDisposition: contentDisposition,
      });

      return getSignedUrl(this.client, command, { expiresIn: params.expiresInSeconds });
    });
  }

  private mapToMetadata(
    objectKey: string,
    context: StorageErrorContext,
    response: HeadObjectCommandOutput,
  ): ObjectMetadata {
    const result = headSchema.safeParse(response);
    if (!result.success) {
      throw new StorageUnavailableError(context, { cause: result.error });
    }

    const contentType = normalizedContentType(result.data.ContentType);
    const sha256Hex = result.data.ChecksumSHA256
      ? sha256Base64ToHex(result.data.ChecksumSHA256)
      : null;

    return {
      objectKey,
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

    const context = {
      operation: 'delete_objects',
      objectCount: objectKeys.length,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(context, async () => {
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
    });
  }

  async getObjectStream(objectKey: string): Promise<Readable> {
    const context = {
      operation: 'get_object_stream',
      objectKey,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(context, async () => {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: config.s3.bucket,
          Key: objectKey,
        }),
      );

      if (!(response.Body instanceof Readable)) {
        throw new StorageUnavailableError(context, {
          cause: new Error('S3 GetObject response is missing a Node.js readable body'),
        });
      }

      return response.Body;
    });
  }

  async uploadObjectStream(params: UploadObjectStreamParams): Promise<void> {
    const context = {
      operation: 'upload_object_stream',
      objectKey: params.objectKey,
    } as const satisfies StorageErrorContext;

    await this.executeStorageOperation(context, async () => {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: config.s3.bucket,
          Key: params.objectKey,
          Body: params.body,
          ContentType: params.contentType,
        },
        partSize: MULTIPART_PART_SIZE_BYTES,
        queueSize: MULTIPART_QUEUE_SIZE,
        leavePartsOnError: false,
      });

      await upload.done();
    });
  }
}
