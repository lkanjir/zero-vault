import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from '../config.js';
import type {
  CompleteMultipartUploadParams,
  CompleteMultipartUploadResult,
  CreateMultipartUploadParams,
  ObjectChecksum,
  ObjectMetadata,
  ObjectStorage,
  SignedDownloadUrlParams,
  SignedUploadPartUrlParams,
  SignedUploadUrlParams,
  UploadObjectStreamParams,
} from './object-storage.js';
import { headSchema } from './head-schema.js';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';
import {
  isValidCompositeSha256,
  sha256Base64ToHex,
  sha256HexToBase64,
} from '../shared/utils/sha256-convert.js';
import { StorageError, type StorageErrorContext } from '../shared/errors/storage/storage-error.js';
import { StorageInvalidPartsError } from '../shared/errors/storage/storage-invalid-parts-error.js';
import { StorageUnavailableError } from '../shared/errors/storage/storage-unavailable-error.js';
import { StorageObjectNotFoundError } from '../shared/errors/storage/storage-object-not-found-error.js';
import { Readable } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';

const MULTIPART_PART_SIZE_BYTES = 32 * 1024 * 1024;
const MULTIPART_QUEUE_SIZE = 2;
const INVALID_MULTIPART_PART_ERROR_NAMES = new Set([
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
  'BadDigest',
  'InvalidDigest',
  'InvalidRequest',
  'InvalidArgument',
  'MalformedXML',
]);

function createS3Client(s3Config: S3Config, endpoint: string): S3Client {
  return new S3Client({
    region: s3Config.region,
    endpoint,
    forcePathStyle: s3Config.forcePathStyle,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

function resolvePresignEndpoint(s3Config: S3Config): string {
  const endpointUrl = new URL(s3Config.endpoint);
  const publicOriginUrl = new URL(s3Config.publicOrigin);

  if (endpointUrl.origin === publicOriginUrl.origin) {
    return s3Config.endpoint;
  }

  if (
    !s3Config.forcePathStyle &&
    publicOriginUrl.protocol === endpointUrl.protocol &&
    publicOriginUrl.port === endpointUrl.port &&
    publicOriginUrl.hostname.toLowerCase() ===
      `${s3Config.bucket.toLowerCase()}.${endpointUrl.hostname.toLowerCase()}`
  ) {
    return s3Config.endpoint;
  }

  return s3Config.publicOrigin;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(s3Config: S3Config) {
    this.bucket = s3Config.bucket;
    this.client = createS3Client(s3Config, s3Config.endpoint);

    const presignEndpoint = resolvePresignEndpoint(s3Config);
    this.presignClient =
      presignEndpoint === s3Config.endpoint
        ? this.client
        : createS3Client(s3Config, presignEndpoint);
  }

  private async executeStorageOperation<T>(
    context: StorageErrorContext,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      const isObjectReadOperation =
        context.operation === 'head_object' || context.operation === 'get_object_stream';

      if (error instanceof StorageError) {
        throw error;
      }

      if (isObjectReadOperation && this.isObjectNotFoundError(error)) {
        throw new StorageObjectNotFoundError(context, { cause: error });
      }

      if (context.operation === 'complete_multipart_upload') {
        if (this.isNoSuchUploadError(error)) {
          throw new StorageObjectNotFoundError(context, { cause: error });
        }

        if (this.isInvalidMultipartPartsError(error)) {
          throw new StorageInvalidPartsError(context, { cause: error });
        }
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

  private isNoSuchUploadError(error: unknown): boolean {
    return error instanceof S3ServiceException && error.name === 'NoSuchUpload';
  }

  private isInvalidMultipartPartsError(error: unknown): boolean {
    return (
      error instanceof S3ServiceException && INVALID_MULTIPART_PART_ERROR_NAMES.has(error.name)
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
        Bucket: this.bucket,
        Key: params.objectKey,
        ContentType: params.contentType,
        ContentLength: params.sizeBytes,
        ChecksumSHA256: hashBase64,
        ChecksumAlgorithm: 'SHA256',
      });

      return getSignedUrl(this.presignClient, command, {
        expiresIn: params.expiresInSeconds,
        signableHeaders: new Set(['content-length']),
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      });
    });
  }

  async createMultipartUpload(params: CreateMultipartUploadParams): Promise<string> {
    const context = {
      operation: 'create_multipart_upload',
      objectKey: params.objectKey,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(context, async () => {
      const command = new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        ContentType: params.contentType,
        ChecksumAlgorithm: 'SHA256',
        ChecksumType: 'COMPOSITE',
      });

      const response = await this.client.send(command);
      const uploadId = response.UploadId?.trim();

      if (!uploadId) {
        throw new StorageUnavailableError(context, {
          cause: new Error('S3 CreateMultipartUpload response is missing UploadId'),
        });
      }

      return uploadId;
    });
  }

  async createPresignedUploadPartUrl(params: SignedUploadPartUrlParams): Promise<string> {
    const context = {
      operation: 'create_upload_part_url',
      objectKey: params.objectKey,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(context, async () => {
      const hashBase64 = sha256HexToBase64(params.sha256Hex);
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        UploadId: params.s3UploadId,
        PartNumber: params.partNumber,
        ContentLength: params.sizeBytes,
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: hashBase64,
      });

      return getSignedUrl(this.presignClient, command, {
        expiresIn: params.expiresInSeconds,
        signableHeaders: new Set(['content-length']),
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      });
    });
  }

  async completeMultipartUpload(
    params: CompleteMultipartUploadParams,
  ): Promise<CompleteMultipartUploadResult> {
    const context = {
      operation: 'complete_multipart_upload',
      objectKey: params.objectKey,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(context, async () => {
      const command = new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        UploadId: params.s3UploadId,
        MultipartUpload: {
          Parts: params.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
            ChecksumSHA256: sha256HexToBase64(part.sha256Hex),
          })),
        },
      });

      const response = await this.client.send(command);
      const rawChecksum = response.ChecksumSHA256?.trim();
      const compositeChecksum =
        rawChecksum && isValidCompositeSha256(rawChecksum) ? rawChecksum : null;

      return { compositeChecksum };
    });
  }

  async abortMultipartUpload(objectKey: string, s3UploadId: string): Promise<void> {
    const context = {
      operation: 'abort_multipart_upload',
      objectKey,
    } as const satisfies StorageErrorContext;

    await this.executeStorageOperation(context, async () => {
      try {
        const command = new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: objectKey,
          UploadId: s3UploadId,
        });
        await this.client.send(command);
      } catch (error) {
        if (this.isNoSuchUploadError(error)) {
          return;
        }

        throw error;
      }
    });
  }

  async headObject(objectKey: string): Promise<ObjectMetadata> {
    const context = {
      operation: 'head_object',
      objectKey,
    } as const satisfies StorageErrorContext;

    const command = new HeadObjectCommand({
      Bucket: this.bucket,
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
      const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey });
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
        Bucket: this.bucket,
        Key: params.objectKey,
        ResponseContentType: params.contentType,
        ResponseContentDisposition: contentDisposition,
      });

      return getSignedUrl(this.presignClient, command, { expiresIn: params.expiresInSeconds });
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
    let checksum: ObjectChecksum | null = null;

    if (result.data.ChecksumSHA256) {
      checksum = isValidCompositeSha256(result.data.ChecksumSHA256)
        ? { type: 'composite_sha256', value: result.data.ChecksumSHA256 }
        : { type: 'full_sha256', value: sha256Base64ToHex(result.data.ChecksumSHA256) };
    }

    return {
      objectKey,
      sizeBytes: result.data.ContentLength,
      contentType,
      checksum,
    };
  }

  private getDisposition(fileName: string): string {
    const encodedFileName = encodeURIComponent(fileName);
    return `attachment; filename*=UTF-8''${encodedFileName}`;
  }

  async getObjectStream(objectKey: string, signal?: AbortSignal): Promise<Readable> {
    const context = {
      operation: 'get_object_stream',
      objectKey,
    } as const satisfies StorageErrorContext;

    return this.executeStorageOperation(
      context,
      async () => {
        signal?.throwIfAborted();

        const command = new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        });
        const response =
          signal !== undefined
            ? await this.client.send(command, { abortSignal: signal })
            : await this.client.send(command);

        if (!(response.Body instanceof Readable)) {
          throw new StorageUnavailableError(context, {
            cause: new Error('S3 GetObject response is missing a Node.js readable body'),
          });
        }

        return response.Body;
      },
      signal,
    );
  }

  async uploadObjectStream(params: UploadObjectStreamParams): Promise<void> {
    const context = {
      operation: 'upload_object_stream',
      objectKey: params.objectKey,
    } as const satisfies StorageErrorContext;

    await this.executeStorageOperation(
      context,
      async () => {
        params.signal?.throwIfAborted();

        const upload = new Upload({
          client: this.client,
          params: {
            Bucket: this.bucket,
            Key: params.objectKey,
            Body: params.body,
            ContentType: params.contentType,
          },
          partSize: MULTIPART_PART_SIZE_BYTES,
          queueSize: MULTIPART_QUEUE_SIZE,
          leavePartsOnError: false,
        });

        const onAbort = () => {
          void upload.abort().catch(() => undefined);
        };

        params.signal?.addEventListener('abort', onAbort, { once: true });

        try {
          await upload.done();
        } finally {
          params.signal?.removeEventListener('abort', onAbort);
        }
      },
      params.signal,
    );
  }
}
