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
import type { UserService } from '../../src/user/user-service.js';
import type { CompleteUploadUseCase } from '../../src/upload/complete-upload-use-case.js';
import { createUploadRouter } from '../../src/upload/upload-routes.js';
import type { UploadService } from '../../src/upload/upload-service.js';

const UPLOAD_ID = '00000000-0000-4000-8000-000000000001';
const EXPECTED_SHA256 = 'a'.repeat(64);

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
  let userService: MockProxy<UserService>;
  let uploadService: MockProxy<UploadService>;
  let completeUploadUseCase: MockProxy<CompleteUploadUseCase>;

  beforeEach(() => {
    userService = mock<UserService>();
    uploadService = mock<UploadService>();
    completeUploadUseCase = mock<CompleteUploadUseCase>();
    userService.resolveUser.mockResolvedValue(USER);
  });

  it('returns duplicate_entry_name when presign precheck finds an existing sibling', async () => {
    uploadService.createUpload.mockRejectedValue(new AppError('duplicate_entry_name'));

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'document.txt',
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
      });

    expectErrorResponse(response, 'duplicate_entry_name');
  });

  it('returns duplicate_entry_name when completion loses a database race', async () => {
    completeUploadUseCase.execute.mockRejectedValue(new AppError('duplicate_entry_name'));

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send();

    expectErrorResponse(response, 'duplicate_entry_name');
  });

  it('returns storage_unavailable when upload presigning fails', async () => {
    uploadService.createUpload.mockRejectedValue(new AppError('storage_unavailable'));

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'document.txt',
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
      });

    expectErrorResponse(response, 'storage_unavailable');
  });

  it('rejects a content type that becomes empty after normalization', async () => {
    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post('/uploads/presign')
      .send({
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
    expect(userService.resolveUser).not.toHaveBeenCalled();
    expect(uploadService.createUpload).not.toHaveBeenCalled();
  });

  it('normalizes the content type before invoking the upload service', async () => {
    uploadService.createUpload.mockResolvedValue({
      uploadId: UPLOAD_ID,
      uploadUrl: 'https://storage.example.test/upload',
      expiresInSeconds: 60,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': Buffer.from(EXPECTED_SHA256, 'hex').toString('base64'),
      },
    });

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'document.txt',
        contentType: ' Text/Plain; charset=utf-8 ',
        size: 12,
        sha256: EXPECTED_SHA256,
      });

    expect(response.status).toBe(201);
    expect(uploadService.createUpload).toHaveBeenCalledExactlyOnceWith(USER, {
      parentFolderId: null,
      fileName: 'document.txt',
      contentType: 'text/plain',
      size: 12,
      sha256: EXPECTED_SHA256,
    });
  });

  it.each([
    'upload_object_missing',
    'upload_expired',
    'upload_checksum_missing',
    'upload_checksum_mismatch',
    'upload_size_mismatch',
    'upload_content_type_mismatch',
    'storage_unavailable',
  ] as const)('returns the %s completion error contract', async (code) => {
    completeUploadUseCase.execute.mockRejectedValue(new AppError(code));

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send();

    expectErrorResponse(response, code);
  });

  it('returns the completed upload using the FileResponse contract', async () => {
    completeUploadUseCase.execute.mockResolvedValue(COMPLETED_FILE);

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual(COMPLETED_FILE);
    expect(completeUploadUseCase.execute).toHaveBeenCalledExactlyOnceWith(USER, UPLOAD_ID);
  });
});

function createTestApp(
  userService: UserService,
  uploadService: UploadService,
  completeUploadUseCase: CompleteUploadUseCase,
) {
  const app = express();

  app.use(requestContext);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    next();
  });
  app.use(
    '/uploads',
    createUploadRouter({
      userService,
      uploadService,
      completeUploadUseCase,
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
