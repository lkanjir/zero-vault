import { Readable } from 'node:stream';
import { S3ServiceException } from '@aws-sdk/client-s3';
import type * as S3ClientModule from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageInvalidPartsError } from '../../src/shared/errors/storage/storage-invalid-parts-error.js';
import { StorageObjectNotFoundError } from '../../src/shared/errors/storage/storage-object-not-found-error.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import { S3ObjectStorage } from '../../src/storage/s3-object-storage.js';
import type { S3Config } from '../../src/config.js';

const TEST_S3_CONFIG: S3Config = {
  endpoint: 'http://localhost:4566',
  publicOrigin: 'http://localhost:4566',
  region: 'eu-central-1',
  forcePathStyle: true,
  accessKeyId: 'test',
  secretAccessKey: 'test',
  bucket: 'test-live',
};

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  uploadDone: vi.fn(),
  uploadAbort: vi.fn(),
  uploadOptions: [] as unknown[],
  s3ClientConfigs: [] as Array<{ endpoint?: string; forcePathStyle?: boolean }>,
  s3Clients: [] as Array<{ config: { endpoint?: string; forcePathStyle?: boolean } }>,
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof S3ClientModule>();

  return {
    ...actual,
    S3Client: class {
      readonly send = mocks.send;
      readonly config: { endpoint?: string; forcePathStyle?: boolean };

      constructor(config: { endpoint?: string; forcePathStyle?: boolean }) {
        this.config = config;
        mocks.s3ClientConfigs.push(config);
        mocks.s3Clients.push(this);
      }
    },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

const getSignedUrlMock = vi.mocked(getSignedUrl);

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    constructor(options: unknown) {
      mocks.uploadOptions.push(options);
    }

    done = mocks.uploadDone;
    abort = mocks.uploadAbort;
  },
}));

describe('S3ObjectStorage errors', () => {
  let storage: S3ObjectStorage;

  beforeEach(() => {
    mocks.s3ClientConfigs.length = 0;
    mocks.s3Clients.length = 0;
    mocks.uploadOptions.length = 0;
    storage = new S3ObjectStorage(TEST_S3_CONFIG);
  });

  it('maps a HEAD 404 to StorageObjectNotFoundError', async () => {
    const providerError = new S3ServiceException({
      name: 'NotFound',
      $fault: 'client',
      $metadata: { httpStatusCode: 404 },
    });
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(storage.headObject('object-key')).rejects.toMatchObject({
      name: StorageObjectNotFoundError.name,
      cause: providerError,
      context: {
        operation: 'head_object',
        objectKey: 'object-key',
      },
    });
  });

  it('maps an unexpected HEAD failure to StorageUnavailableError', async () => {
    const providerError = new Error('S3 unavailable');
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(storage.headObject('object-key')).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      cause: providerError,
      context: {
        operation: 'head_object',
        objectKey: 'object-key',
      },
    });
  });

  it('maps an invalid HEAD response to StorageUnavailableError', async () => {
    mocks.send.mockResolvedValueOnce({
      ContentLength: 'invalid',
      ContentType: 'text/plain',
    });

    await expect(storage.headObject('object-key')).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      context: {
        operation: 'head_object',
        objectKey: 'object-key',
      },
    });
  });

  it('uses create_download_url context for download presign failures', async () => {
    const providerError = new Error('Presign unavailable');
    getSignedUrlMock.mockRejectedValueOnce(providerError);

    await expect(
      storage.createPresignedDownloadUrl({
        objectKey: 'object-key',
        fileName: 'document.txt',
        contentType: 'text/plain',
        expiresInSeconds: 60,
      }),
    ).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      cause: providerError,
      context: {
        operation: 'create_download_url',
        objectKey: 'object-key',
      },
    });
  });

  it('presigns the exact single-part upload length', async () => {
    getSignedUrlMock.mockResolvedValueOnce('https://storage.example.test/upload');

    await expect(
      storage.createPresignedUploadUrl({
        objectKey: 'object-key',
        contentType: 'text/plain',
        sizeBytes: 12,
        expiresInSeconds: 60,
        sha256Hex: 'a'.repeat(64),
      }),
    ).resolves.toBe('https://storage.example.test/upload');

    expect(getSignedUrlMock).toHaveBeenCalledOnce();
    const [, command, options] = getSignedUrlMock.mock.lastCall!;

    expect(command.input).toMatchObject({
      Bucket: process.env['S3_BUCKET'],
      Key: 'object-key',
      ContentType: 'text/plain',
      ContentLength: 12,
      ChecksumSHA256: Buffer.from('a'.repeat(64), 'hex').toString('base64'),
      ChecksumAlgorithm: 'SHA256',
    });
    expect(options).toStrictEqual({
      expiresIn: 60,
      signableHeaders: new Set(['content-length']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
  });

  it('maps a DELETE failure to StorageUnavailableError', async () => {
    const providerError = new Error('Delete unavailable');
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(storage.deleteObject('object-key')).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      cause: providerError,
      context: {
        operation: 'delete_object',
        objectKey: 'object-key',
      },
    });
  });

  it('returns a Node.js readable GET body', async () => {
    const body = Readable.from(['content']);
    mocks.send.mockResolvedValueOnce({ Body: body });

    await expect(storage.getObjectStream('object-key')).resolves.toBe(body);
  });

  it('maps a GET 404 to StorageObjectNotFoundError', async () => {
    const providerError = new S3ServiceException({
      name: 'NotFound',
      $fault: 'client',
      $metadata: { httpStatusCode: 404 },
    });
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(storage.getObjectStream('object-key')).rejects.toMatchObject({
      name: StorageObjectNotFoundError.name,
      cause: providerError,
      context: {
        operation: 'get_object_stream',
        objectKey: 'object-key',
      },
    });
  });

  it('rejects a GET response without a Node.js readable body', async () => {
    mocks.send.mockResolvedValueOnce({ Body: new Uint8Array([1, 2, 3]) });

    await expect(storage.getObjectStream('object-key')).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      context: {
        operation: 'get_object_stream',
        objectKey: 'object-key',
      },
    });
  });

  it('uploads a stream with bounded multipart concurrency and automatic abort cleanup', async () => {
    const body = Readable.from(['content']);
    mocks.uploadDone.mockResolvedValueOnce(undefined);

    await expect(
      storage.uploadObjectStream({
        objectKey: 'archive.zip',
        contentType: 'application/zip',
        body,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.uploadDone).toHaveBeenCalledOnce();
    expect(mocks.uploadOptions).toHaveLength(1);
    expect(mocks.uploadOptions[0]).toMatchObject({
      params: {
        Bucket: process.env['S3_BUCKET'],
        Key: 'archive.zip',
        Body: body,
        ContentType: 'application/zip',
      },
      partSize: 32 * 1024 * 1024,
      queueSize: 2,
      leavePartsOnError: false,
    });
  });

  it('maps a multipart upload failure to StorageUnavailableError', async () => {
    const providerError = new Error('Upload unavailable');
    mocks.uploadDone.mockRejectedValueOnce(providerError);

    await expect(
      storage.uploadObjectStream({
        objectKey: 'archive.zip',
        contentType: 'application/zip',
        body: Readable.from(['content']),
      }),
    ).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      cause: providerError,
      context: {
        operation: 'upload_object_stream',
        objectKey: 'archive.zip',
      },
    });
  });

  it('returns normalized metadata for a valid HEAD response with full SHA-256', async () => {
    const checksum = Buffer.alloc(32, 0xaa).toString('base64');
    mocks.send.mockResolvedValueOnce({
      ContentLength: 12,
      ContentType: ' text/plain ',
      ChecksumSHA256: checksum,
    });

    await expect(storage.headObject('object-key')).resolves.toStrictEqual({
      objectKey: 'object-key',
      sizeBytes: 12,
      contentType: 'text/plain',
      checksum: {
        type: 'full_sha256',
        value: 'aa'.repeat(32),
      },
    });
  });

  it('returns normalized metadata for a valid HEAD response with composite SHA-256', async () => {
    const compositeChecksum = `${Buffer.alloc(32, 0xbb).toString('base64')}-3`;
    mocks.send.mockResolvedValueOnce({
      ContentLength: 50 * 1024 * 1024,
      ContentType: 'application/octet-stream',
      ChecksumSHA256: compositeChecksum,
      ChecksumType: 'COMPOSITE',
    });

    await expect(storage.headObject('object-key')).resolves.toStrictEqual({
      objectKey: 'object-key',
      sizeBytes: 50 * 1024 * 1024,
      contentType: 'application/octet-stream',
      checksum: {
        type: 'composite_sha256',
        value: compositeChecksum,
      },
    });
  });

  it('creates a multipart upload configured for composite SHA-256 checksums', async () => {
    mocks.send.mockResolvedValueOnce({ UploadId: 'upload-123' });

    await expect(
      storage.createMultipartUpload({
        objectKey: 'object-key',
        contentType: 'application/octet-stream',
      }),
    ).resolves.toBe('upload-123');

    const command = mocks.send.mock.lastCall?.[0] as { input: unknown };
    expect(command.input).toMatchObject({
      Bucket: TEST_S3_CONFIG.bucket,
      Key: 'object-key',
      ContentType: 'application/octet-stream',
      ChecksumAlgorithm: 'SHA256',
      ChecksumType: 'COMPOSITE',
    });
  });

  it('rejects a CreateMultipartUpload response without an UploadId', async () => {
    mocks.send.mockResolvedValueOnce({});

    await expect(
      storage.createMultipartUpload({
        objectKey: 'object-key',
        contentType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      context: {
        operation: 'create_multipart_upload',
        objectKey: 'object-key',
      },
    });
  });

  it('presigns a multipart part upload with exact content length and SHA-256 checksum', async () => {
    getSignedUrlMock.mockResolvedValueOnce('https://storage.example.test/part-1');

    await expect(
      storage.createPresignedUploadPartUrl({
        objectKey: 'object-key',
        s3UploadId: 'upload-123',
        partNumber: 2,
        sizeBytes: 16 * 1024 * 1024,
        expiresInSeconds: 900,
        sha256Hex: 'a'.repeat(64),
      }),
    ).resolves.toBe('https://storage.example.test/part-1');

    const [, command, options] = getSignedUrlMock.mock.lastCall!;
    expect(command.input).toMatchObject({
      Bucket: TEST_S3_CONFIG.bucket,
      Key: 'object-key',
      UploadId: 'upload-123',
      PartNumber: 2,
      ContentLength: 16 * 1024 * 1024,
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: Buffer.from('a'.repeat(64), 'hex').toString('base64'),
    });
    expect(options).toStrictEqual({
      expiresIn: 900,
      signableHeaders: new Set(['content-length']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
  });

  it('completes a multipart upload with part ETags and per-part SHA-256 checksums', async () => {
    const compositeChecksum = `${Buffer.alloc(32, 0xcc).toString('base64')}-2`;
    mocks.send.mockResolvedValueOnce({ ChecksumSHA256: compositeChecksum });

    await expect(
      storage.completeMultipartUpload({
        objectKey: 'object-key',
        s3UploadId: 'upload-123',
        parts: [
          { partNumber: 1, etag: '"etag-1"', sha256Hex: 'a'.repeat(64) },
          { partNumber: 2, etag: '"etag-2"', sha256Hex: 'b'.repeat(64) },
        ],
      }),
    ).resolves.toStrictEqual({ compositeChecksum });

    const command = mocks.send.mock.lastCall?.[0] as { input: unknown };
    expect(command.input).toMatchObject({
      Bucket: TEST_S3_CONFIG.bucket,
      Key: 'object-key',
      UploadId: 'upload-123',
      MultipartUpload: {
        Parts: [
          {
            PartNumber: 1,
            ETag: '"etag-1"',
            ChecksumSHA256: Buffer.from('a'.repeat(64), 'hex').toString('base64'),
          },
          {
            PartNumber: 2,
            ETag: '"etag-2"',
            ChecksumSHA256: Buffer.from('b'.repeat(64), 'hex').toString('base64'),
          },
        ],
      },
    });
  });

  it('maps InvalidPart on CompleteMultipartUpload to StorageInvalidPartsError', async () => {
    const providerError = new S3ServiceException({
      name: 'InvalidPart',
      $fault: 'client',
      $metadata: { httpStatusCode: 400 },
    });
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(
      storage.completeMultipartUpload({
        objectKey: 'object-key',
        s3UploadId: 'upload-123',
        parts: [{ partNumber: 1, etag: '"bad"', sha256Hex: 'a'.repeat(64) }],
      }),
    ).rejects.toMatchObject({
      name: StorageInvalidPartsError.name,
      cause: providerError,
      context: {
        operation: 'complete_multipart_upload',
        objectKey: 'object-key',
      },
    });
  });

  it('maps NoSuchUpload on CompleteMultipartUpload to StorageObjectNotFoundError', async () => {
    const providerError = new S3ServiceException({
      name: 'NoSuchUpload',
      $fault: 'client',
      $metadata: { httpStatusCode: 404 },
    });
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(
      storage.completeMultipartUpload({
        objectKey: 'object-key',
        s3UploadId: 'upload-123',
        parts: [{ partNumber: 1, etag: '"etag-1"', sha256Hex: 'a'.repeat(64) }],
      }),
    ).rejects.toMatchObject({
      name: StorageObjectNotFoundError.name,
      cause: providerError,
      context: {
        operation: 'complete_multipart_upload',
        objectKey: 'object-key',
      },
    });
  });

  it('treats NoSuchUpload on AbortMultipartUpload as idempotent success', async () => {
    const providerError = new S3ServiceException({
      name: 'NoSuchUpload',
      $fault: 'client',
      $metadata: { httpStatusCode: 404 },
    });
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(storage.abortMultipartUpload('object-key', 'upload-123')).resolves.toBeUndefined();
  });

  it('maps unexpected AbortMultipartUpload errors to StorageUnavailableError', async () => {
    const providerError = new Error('S3 down');
    mocks.send.mockRejectedValueOnce(providerError);

    await expect(storage.abortMultipartUpload('object-key', 'upload-123')).rejects.toMatchObject({
      name: StorageUnavailableError.name,
      cause: providerError,
      context: {
        operation: 'abort_multipart_upload',
        objectKey: 'object-key',
      },
    });
  });

  it('forwards AbortSignal to GetObjectCommand and propagates abort errors', async () => {
    const controller = new AbortController();
    const abortError = new Error('request aborted');
    mocks.send.mockImplementationOnce(() => {
      controller.abort(abortError);
      return Promise.reject(abortError);
    });

    await expect(storage.getObjectStream('object-key', controller.signal)).rejects.toBe(abortError);
    expect(mocks.send).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: controller.signal,
    });
  });

  it('aborts an in-flight multipart upload when the signal aborts', async () => {
    const controller = new AbortController();
    const abortError = new Error('upload aborted');
    mocks.uploadAbort.mockRejectedValueOnce(new Error('abort cleanup failed'));
    mocks.uploadDone.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(abortError), { once: true });
        }),
    );

    const uploadPromise = storage.uploadObjectStream({
      objectKey: 'archive.zip',
      contentType: 'application/zip',
      body: Readable.from(['content']),
      signal: controller.signal,
    });

    controller.abort(abortError);

    await expect(uploadPromise).rejects.toBe(abortError);
    expect(mocks.uploadAbort).toHaveBeenCalledOnce();
  });

  it('reuses a single S3Client when endpoint and publicOrigin share the same origin', async () => {
    expect(mocks.s3ClientConfigs).toHaveLength(1);
    expect(mocks.s3ClientConfigs[0]?.endpoint).toBe(TEST_S3_CONFIG.endpoint);

    getSignedUrlMock.mockResolvedValueOnce('http://localhost:4566/test-live/object-key');
    await storage.createPresignedDownloadUrl({
      objectKey: 'object-key',
      fileName: 'document.txt',
      contentType: 'text/plain',
      expiresInSeconds: 60,
    });

    expect(getSignedUrlMock.mock.lastCall![0]).toBe(mocks.s3Clients[0]);
  });

  it('uses a dedicated presigner client configured with publicOrigin when endpoints differ', async () => {
    mocks.s3ClientConfigs.length = 0;
    mocks.s3Clients.length = 0;

    const splitStorage = new S3ObjectStorage({
      ...TEST_S3_CONFIG,
      endpoint: 'http://minio:9000',
      publicOrigin: 'https://storage.example.com',
    });

    expect(mocks.s3ClientConfigs).toHaveLength(2);
    expect(mocks.s3ClientConfigs[0]?.endpoint).toBe('http://minio:9000');
    expect(mocks.s3ClientConfigs[1]?.endpoint).toBe('https://storage.example.com');

    const [internalClient, presignClient] = mocks.s3Clients;

    getSignedUrlMock.mockResolvedValueOnce('https://storage.example.com/test-live/object-key');
    await splitStorage.createPresignedUploadUrl({
      objectKey: 'object-key',
      contentType: 'text/plain',
      sizeBytes: 12,
      expiresInSeconds: 600,
      sha256Hex: 'a'.repeat(64),
    });
    expect(getSignedUrlMock.mock.lastCall![0]).toBe(presignClient);

    getSignedUrlMock.mockResolvedValueOnce('https://storage.example.com/test-live/object-key');
    await splitStorage.createPresignedDownloadUrl({
      objectKey: 'object-key',
      fileName: 'document.txt',
      contentType: 'text/plain',
      expiresInSeconds: 60,
    });
    expect(getSignedUrlMock.mock.lastCall![0]).toBe(presignClient);

    mocks.uploadDone.mockResolvedValueOnce(undefined);
    await splitStorage.uploadObjectStream({
      objectKey: 'archive.zip',
      contentType: 'application/zip',
      body: Readable.from(['content']),
    });
    expect((mocks.uploadOptions[0] as { client: unknown }).client).toBe(internalClient);
  });

  it('reuses the internal endpoint client for virtual-hosted bucket publicOrigin when forcePathStyle is false', () => {
    mocks.s3ClientConfigs.length = 0;
    mocks.s3Clients.length = 0;

    new S3ObjectStorage({
      ...TEST_S3_CONFIG,
      endpoint: 'https://s3.eu-central-1.amazonaws.com',
      publicOrigin: 'https://test-live.s3.eu-central-1.amazonaws.com',
      forcePathStyle: false,
    });

    expect(mocks.s3ClientConfigs).toHaveLength(1);
    expect(mocks.s3ClientConfigs[0]?.endpoint).toBe('https://s3.eu-central-1.amazonaws.com');
  });
});
