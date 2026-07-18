import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import type { FileResponse } from '../../src/files/dto.js';
import { DuplicateEntryNameError } from '../../src/shared/errors/duplicate-entry-name-error.js';
import { errorHandler } from '../../src/shared/validation/error-handler.js';
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
  username: 'test',
};

const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: PRINCIPAL.issuer,
  subject: PRINCIPAL.subject,
  username: PRINCIPAL.username!,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
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
    uploadService.createUpload.mockRejectedValue(new DuplicateEntryNameError());

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post('/uploads/presign')
      .send({
        parentFolderId: null,
        fileName: 'document.txt',
        contentType: 'text/plain',
        size: 12,
        sha256: EXPECTED_SHA256,
      });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({
      error: 'Entry with this name already exists in this folder',
      code: 'duplicate_entry_name',
    });
  });

  it('returns duplicate_entry_name when completion loses a database race', async () => {
    completeUploadUseCase.execute.mockRejectedValue(new DuplicateEntryNameError());

    const response = await request(createTestApp(userService, uploadService, completeUploadUseCase))
      .post(`/uploads/${UPLOAD_ID}/complete`)
      .send();

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({
      error: 'Entry with this name already exists in this folder',
      code: 'duplicate_entry_name',
    });
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
