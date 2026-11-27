import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import type { FileResponse } from '../../src/files/dto.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import { errorCatalog, type ErrorCode } from '../../src/shared/errors/api/error-catalog.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import type { User } from '../../src/user/user.js';
import { createUploadRouter } from '../../src/upload/upload-routes.js';
import type { UploadService } from '../../src/upload/upload-service.js';
import { MAX_UPLOAD_SIZE_BYTES, SINGLE_PART_MAX_BYTES } from '../../src/upload/upload-sizing.js';

const UPLOAD_ID = '00000000-0000-4000-8000-000000000001';
const EXPECTED_SHA256 = 'a'.repeat(64);
const OTHER_SHA256 = 'b'.repeat(64);

const COMPLETED_FILE: FileResponse = {
  kind: 'file',
  id: '20000000-0000-4000-8000-000000000001',
  name: 'document.txt',
  contentType: 'text/plain',
  sizeBytes: 12,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PRINCIPAL: AuthenticatedPrincipal = {
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
};

const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: PRINCIPAL.issuer,
  subject: PRINCIPAL.subject,
  email: PRINCIPAL.email,
  firstName: PRINCIPAL.firstName,
  lastName: PRINCIPAL.lastName,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

describe('upload routes contract', () => {
  let uploadService: MockProxy<UploadService>;

  beforeEach(() => {
    uploadService = mock<UploadService>();
  });

  it('returns duplicate_entry_name when presign precheck finds an existing sibling', async () => {
    uploadService.createUpload.mockRejectedValue(new AppError('duplicate_entry_name'));

    const response = await request(createTestApp(uploadService)).post('/uploads/presign').send({
      parentFolderId: null,
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    expectErrorResponse(response, 'duplicate_entry_name');
  });

  it('returns duplicate_entry_name when completion loses a database race', async () => {
    uploadService.completeUpload.mockRejectedValue(new AppError('duplicate_entry_name'));

    const response = await request(createTestApp(uploadService))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send();

    expectErrorResponse(response, 'duplicate_entry_name');
  });

  it('returns storage_unavailable when upload presigning fails', async () => {
    uploadService.createUpload.mockRejectedValue(new AppError('storage_unavailable'));

    const response = await request(createTestApp(uploadService)).post('/uploads/presign').send({
      parentFolderId: null,
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    expectErrorResponse(response, 'storage_unavailable');
  });

  it('rejects a content type that becomes empty after normalization', async () => {
    const response = await request(createTestApp(uploadService)).post('/uploads/presign').send({
      parentFolderId: null,
      fileName: 'document.txt',
      contentType: '; charset=utf-8',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    const body = response.body as ErrorResponse;

    expect(response.status).toBe(errorCatalog.invalid_request_body.status);
    expect(body).toMatchObject({
      code: 'invalid_request_body',
      message: errorCatalog.invalid_request_body.message,
    });
    expect(typeof body.requestId).toBe('string');
    expect(Array.isArray(body.details?.issues)).toBe(true);
    expect(body.details?.issues[0]).toMatchObject({
      code: 'too_small',
      path: ['contentType'],
    });
    expect(uploadService.createUpload).not.toHaveBeenCalled();
  });

  it.each(['.', '..', 'a/b.txt', 'a\\b.txt', 'bad\0.txt', 'bad\n.txt'])(
    'rejects unsafe upload fileName %j before resolving the user',
    async (fileName) => {
      const response = await request(createTestApp(uploadService)).post('/uploads/presign').send({
        parentFolderId: null,
        fileName,
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
      });

      expect(response.status).toBe(400);
      expect((response.body as ErrorResponse).code).toBe('invalid_request_body');
      expect(uploadService.createUpload).not.toHaveBeenCalled();
    },
  );

  it('normalizes the content type before invoking the upload service', async () => {
    uploadService.createUpload.mockResolvedValue({
      uploadMode: 'single',
      uploadId: UPLOAD_ID,
      uploadUrl: 'https://storage.example.test/upload',
      expiresInSeconds: 60,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': Buffer.from(EXPECTED_SHA256, 'hex').toString('base64'),
      },
    });

    const response = await request(createTestApp(uploadService)).post('/uploads/presign').send({
      parentFolderId: null,
      fileName: 'document.txt',
      contentType: ' Text/Plain; charset=utf-8 ',
      size: 12,
      sha256: EXPECTED_SHA256,
    });

    expect(response.status).toBe(201);
    expect(response.headers['ratelimit-policy']).toContain('"upload-intent"');
    expect(response.headers['ratelimit-policy']).toContain('q=120');
    expect(response.headers['ratelimit-policy']).toContain('w=60');
    expect(uploadService.createUpload).toHaveBeenCalledExactlyOnceWith(USER, {
      parentFolderId: null,
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });
  });

  it('forwards conflictStrategy=rename and rejects unknown conflictStrategy values', async () => {
    uploadService.createUpload.mockResolvedValue({
      uploadMode: 'single',
      uploadId: UPLOAD_ID,
      uploadUrl: 'https://storage.example.test/upload',
      expiresInSeconds: 600,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': Buffer.from(EXPECTED_SHA256, 'hex').toString('base64'),
      },
    });

    const renameResponse = await request(createTestApp(uploadService))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'document.txt',
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
        conflictStrategy: 'rename',
      });

    expect(renameResponse.status).toBe(201);
    expect(uploadService.createUpload).toHaveBeenCalledExactlyOnceWith(USER, {
      parentFolderId: null,
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
      conflictStrategy: 'rename',
    });

    uploadService.createUpload.mockClear();

    const invalidResponse = await request(createTestApp(uploadService))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'document.txt',
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
        conflictStrategy: 'overwrite',
      });

    expect(invalidResponse.status).toBe(400);
    expect((invalidResponse.body as ErrorResponse).code).toBe('invalid_request_body');
    expect(uploadService.createUpload).not.toHaveBeenCalled();
  });

  it('accepts a 0-byte empty file and the maximum single-part upload size (16 MiB)', async () => {
    uploadService.createUpload.mockResolvedValue({
      uploadMode: 'single',
      uploadId: UPLOAD_ID,
      uploadUrl: 'https://storage.example.test/upload',
      expiresInSeconds: 600,
      requiredHeaders: {
        'Content-Type': 'application/octet-stream',
        'x-amz-checksum-sha256': Buffer.from(EXPECTED_SHA256, 'hex').toString('base64'),
      },
    });

    const emptyResponse = await request(createTestApp(uploadService))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'empty.txt',
        contentType: 'text/plain',
        size: 0,
        sha256: EXPECTED_SHA256,
      });
    expect(emptyResponse.status).toBe(201);

    const maxSingleResponse = await request(createTestApp(uploadService))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'maximum-single.bin',
        contentType: 'application/octet-stream',
        size: SINGLE_PART_MAX_BYTES,
        sha256: EXPECTED_SHA256,
      });

    expect(maxSingleResponse.status).toBe(201);
  });

  it('accepts multipart upload intents up to 512 GiB without upfront sha256 and rejects larger files', async () => {
    uploadService.createUpload.mockResolvedValue({
      uploadMode: 'multipart',
      uploadId: UPLOAD_ID,
      partSizeBytes: 64 * 1024 * 1024,
      partCount: 8_192,
      finalizeDeadline: '2026-08-10T11:00:00.000Z',
    });

    const maxMultipartResponse = await request(createTestApp(uploadService))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'huge.bin',
        contentType: 'application/octet-stream',
        size: MAX_UPLOAD_SIZE_BYTES,
      });
    expect(maxMultipartResponse.status).toBe(201);
    expect(uploadService.createUpload).toHaveBeenCalledExactlyOnceWith(USER, {
      parentFolderId: null,
      fileName: 'huge.bin',
      contentType: 'application/octet-stream',
      size: MAX_UPLOAD_SIZE_BYTES,
      sha256: undefined,
    });

    uploadService.createUpload.mockClear();

    const oversizedResponse = await request(createTestApp(uploadService))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'too-large.bin',
        contentType: 'application/octet-stream',
        size: MAX_UPLOAD_SIZE_BYTES + 1,
      });

    const body = oversizedResponse.body as ErrorResponse;
    expect(oversizedResponse.status).toBe(400);
    expect(body).toMatchObject({
      code: 'invalid_request_body',
      message: errorCatalog.invalid_request_body.message,
    });
    expect(body.details?.issues).toContainEqual(
      expect.objectContaining({
        code: 'too_big',
        path: ['size'],
      }),
    );
    expect(uploadService.createUpload).not.toHaveBeenCalled();
  });

  it('enforces sha256 presence for <= 16 MiB and forbids upfront sha256 for > 16 MiB', async () => {
    const missingSha = await request(createTestApp(uploadService)).post('/uploads/presign').send({
      parentFolderId: null,
      fileName: 'small.bin',
      contentType: 'application/octet-stream',
      size: SINGLE_PART_MAX_BYTES,
    });
    expect(missingSha.status).toBe(400);
    expect((missingSha.body as ErrorResponse).code).toBe('invalid_request_body');

    const unexpectedSha = await request(createTestApp(uploadService))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'multipart.bin',
        contentType: 'application/octet-stream',
        size: SINGLE_PART_MAX_BYTES + 1,
        sha256: EXPECTED_SHA256,
      });
    expect(unexpectedSha.status).toBe(400);
    expect((unexpectedSha.body as ErrorResponse).code).toBe('invalid_request_body');
    expect(uploadService.createUpload).not.toHaveBeenCalled();
  });

  it('presigns a batch of multipart parts and rejects duplicate part numbers', async () => {
    uploadService.presignParts.mockResolvedValue({
      uploadId: UPLOAD_ID,
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://storage.example.test/part-1',
          expiresInSeconds: 900,
          requiredHeaders: {
            'x-amz-checksum-sha256': Buffer.from(EXPECTED_SHA256, 'hex').toString('base64'),
          },
        },
      ],
    });

    const okResponse = await request(createTestApp(uploadService))
      .post(`/uploads/${UPLOAD_ID}/parts/presign`)
      .send({
        parts: [{ partNumber: 1, sha256: EXPECTED_SHA256.toUpperCase() }],
      });

    expect(okResponse.status).toBe(200);
    expect(okResponse.headers['ratelimit-policy']).toContain('"upload-part-presign"');
    expect(uploadService.presignParts).toHaveBeenCalledExactlyOnceWith(USER, UPLOAD_ID, {
      parts: [{ partNumber: 1, sha256: EXPECTED_SHA256 }],
    });

    const duplicateResponse = await request(createTestApp(uploadService))
      .post(`/uploads/${UPLOAD_ID}/parts/presign`)
      .send({
        parts: [
          { partNumber: 1, sha256: EXPECTED_SHA256 },
          { partNumber: 1, sha256: OTHER_SHA256 },
        ],
      });
    expect(duplicateResponse.status).toBe(400);
    expect((duplicateResponse.body as ErrorResponse).code).toBe('invalid_request_body');
  });

  it.each([
    'upload_object_missing',
    'upload_expired',
    'upload_aborted',
    'upload_already_completed',
    'upload_mode_mismatch',
    'upload_parts_invalid',
    'upload_checksum_missing',
    'upload_checksum_mismatch',
    'upload_size_mismatch',
    'upload_content_type_mismatch',
    'replacement_conflict',
    'storage_unavailable',
  ] as const)('returns the %s completion error contract', async (code) => {
    uploadService.completeUpload.mockRejectedValue(new AppError(code));

    const response = await request(createTestApp(uploadService))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send();

    expectErrorResponse(response, code);
  });

  it('returns the completed upload using the FileResponse contract for single-part and large multipart manifests', async () => {
    uploadService.completeUpload.mockResolvedValue(COMPLETED_FILE);

    const singleResponse = await request(createTestApp(uploadService))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send();

    expect(singleResponse.status).toBe(200);
    expect(singleResponse.headers['ratelimit-policy']).toContain('"upload-completion"');
    expect(singleResponse.headers['ratelimit-policy']).toContain('q=120');
    expect(singleResponse.headers['ratelimit-policy']).toContain('w=60');
    expect(singleResponse.body).toStrictEqual(COMPLETED_FILE);
    expect(uploadService.completeUpload).toHaveBeenCalledWith(USER, UPLOAD_ID, {
      parts: undefined,
    });

    // > 16 KB multipart manifest (300 parts ~ 40 KB JSON) succeeds on /complete
    const largeParts = Array.from({ length: 300 }, (_, index) => ({
      partNumber: index + 1,
      etag: `"etag-${index + 1}"`,
      sha256: EXPECTED_SHA256,
    }));
    const multipartResponse = await request(createTestApp(uploadService))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send({ parts: largeParts });

    expect(multipartResponse.status).toBe(200);
    expect(uploadService.completeUpload).toHaveBeenLastCalledWith(USER, UPLOAD_ID, {
      parts: largeParts,
    });
  });

  it('aborts an upload and returns 204 No Content', async () => {
    uploadService.abortUpload.mockResolvedValue(undefined);

    const response = await request(createTestApp(uploadService))
      .post(`/uploads/${UPLOAD_ID}/abort`)
      .send();

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(uploadService.abortUpload).toHaveBeenCalledExactlyOnceWith(USER, UPLOAD_ID);
  });
});

function createTestApp(uploadService: UploadService) {
  const app = express();

  app.use(requestContext);
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    req.user = USER;
    next();
  });
  app.use(
    '/uploads',
    createUploadRouter({
      uploadService,
    }),
  );
  app.use(errorHandler);

  return app;
}

function expectErrorResponse(response: { status: number; body: unknown }, code: ErrorCode): void {
  const body = response.body as ErrorResponse;

  expect(response.status).toBe(errorCatalog[code].status);
  expect(body).toStrictEqual({
    code,
    message: errorCatalog[code].message,
    requestId: body.requestId,
  });
  expect(typeof body.requestId).toBe('string');
}
