import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import type { FileDownloadService } from '../../src/files/file-download-service.js';
import { createFilesRouter } from '../../src/files/files-routes.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import type { User } from '../../src/user/user.js';
import type { UserService } from '../../src/user/user-service.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';

const FILE_ID = '20000000-0000-4000-8000-000000000001';
const DOWNLOAD_URL = 'https://storage.example.test/download';

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

describe('files routes', () => {
  let userService: MockProxy<UserService>;
  let downloadService: MockProxy<FileDownloadService>;

  beforeEach(() => {
    userService = mock<UserService>();
    downloadService = mock<FileDownloadService>();

    userService.resolveUser.mockResolvedValue(USER);
    downloadService.createDownloadUrl.mockResolvedValue({
      fileId: FILE_ID,
      fileName: 'document.txt',
      contentType: 'text/plain',
      sizeBytes: 12,
      downloadUrl: DOWNLOAD_URL,
      expiresInSeconds: 60,
    });
  });

  it('creates a download URL for the fileId route parameter', async () => {
    const response = await request(createTestApp(userService, downloadService)).post(
      `/files/${FILE_ID}/download-url`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      fileId: FILE_ID,
      fileName: 'document.txt',
      contentType: 'text/plain',
      sizeBytes: 12,
      downloadUrl: DOWNLOAD_URL,
      expiresInSeconds: 60,
    });
    expect(downloadService.createDownloadUrl).toHaveBeenCalledExactlyOnceWith(USER, FILE_ID);
  });

  it('rejects invalid fileId before calling the download service', async () => {
    const response = await request(createTestApp(userService, downloadService)).post(
      '/files/not-a-uuid/download-url',
    );
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: 'invalid_request_params',
      message: 'Parametri putanje nisu ispravni.',
    });
    expect(typeof body.requestId).toBe('string');
    expect(Array.isArray(body.details?.issues)).toBe(true);
    expect(downloadService.createDownloadUrl).not.toHaveBeenCalled();
  });
});

function createTestApp(userService: UserService, downloadService: FileDownloadService) {
  const app = express();

  app.use(requestContext);
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    next();
  });
  app.use('/files', createFilesRouter({ userService, downloadService }));
  app.use(errorHandler);

  return app;
}
