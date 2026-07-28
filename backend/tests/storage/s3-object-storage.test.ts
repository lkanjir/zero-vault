import { Readable } from 'node:stream';
import { S3ServiceException } from '@aws-sdk/client-s3';
import type * as S3ClientModule from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageObjectNotFoundError } from '../../src/shared/errors/storage/storage-object-not-found-error.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import { S3ObjectStorage } from '../../src/storage/s3-object-storage.js';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  uploadDone: vi.fn(),
  uploadOptions: [] as unknown[],
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof S3ClientModule>();

  return {
    ...actual,
    S3Client: class {
      readonly send = mocks.send;
    },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    constructor(options: unknown) {
      mocks.uploadOptions.push(options);
    }

    done = mocks.uploadDone;
  },
}));

describe('S3ObjectStorage errors', () => {
  let storage: S3ObjectStorage;

  beforeEach(() => {
    storage = new S3ObjectStorage();
    mocks.uploadOptions.length = 0;
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
    mocks.getSignedUrl.mockRejectedValueOnce(providerError);

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

  it('returns normalized metadata for a valid HEAD response', async () => {
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
      sha256Hex: 'aa'.repeat(32),
    });
  });
});
