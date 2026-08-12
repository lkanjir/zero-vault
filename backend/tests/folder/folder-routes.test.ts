import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import type { FolderDownloadService } from '../../src/folder/download/folder-download-service.js';
import { createFolderRouter } from '../../src/folder/folder-routes.js';
import type { FolderService } from '../../src/folder/folder-service.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import type { User } from '../../src/user/user.js';
import type { UserService } from '../../src/user/user-service.js';

const FOLDER_ID = '20000000-0000-4000-8000-000000000001';
const DOWNLOAD_ID = '30000000-0000-4000-8000-000000000001';
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
};

describe('folder routes', () => {
  let userService: MockProxy<UserService>;
  let folderService: MockProxy<FolderService>;
  let folderDownloadService: MockProxy<FolderDownloadService>;

  beforeEach(() => {
    userService = mock<UserService>();
    folderService = mock<FolderService>();
    folderDownloadService = mock<FolderDownloadService>();

    userService.resolveUser.mockResolvedValue(USER);
    folderService.createFolder.mockResolvedValue({
      kind: 'folder',
      id: FOLDER_ID,
      name: 'Documents',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    folderDownloadService.createDownload.mockResolvedValue({
      downloadId: DOWNLOAD_ID,
      fileName: 'Documents.zip',
      status: 'queued',
    });
  });

  it('creates a root folder using the normalized request body', async () => {
    const response = await request(createTestApp(userService, folderService, folderDownloadService))
      .post('/folders')
      .send({ name: ' Documents ' });

    expect(response.status).toBe(201);
    expect(response.body).toStrictEqual({
      kind: 'folder',
      id: FOLDER_ID,
      name: 'Documents',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(folderService.createFolder).toHaveBeenCalledExactlyOnceWith(USER, {
      parentId: null,
      name: 'Documents',
    });
  });

  it('accepts a folder download and returns polling headers', async () => {
    const response = await request(
      createTestApp(userService, folderService, folderDownloadService),
    ).post(`/folders/${FOLDER_ID}/downloads`);

    expect(response.status).toBe(202);
    expect(response.headers['ratelimit-policy']).toContain('"folder-download"');
    expect(response.headers['ratelimit-policy']).toContain('q=10');
    expect(response.headers['ratelimit-policy']).toContain('w=600');
    expect(response.headers['location']).toBe(`/api/folders/downloads/${DOWNLOAD_ID}`);
    expect(response.headers['retry-after']).toBe('2');
    expect(response.body).toStrictEqual({
      downloadId: DOWNLOAD_ID,
      fileName: 'Documents.zip',
      status: 'queued',
    });
    expect(folderDownloadService.createDownload).toHaveBeenCalledExactlyOnceWith(USER, FOLDER_ID);
  });

  it('rate limits folder download creation per authenticated principal', async () => {
    const app = createTestApp(userService, folderService, folderDownloadService, {
      ...PRINCIPAL,
      subject: 'folder-download-rate-limit-user',
    });

    for (let index = 0; index < 10; index += 1) {
      const response = await request(app).post(`/folders/${FOLDER_ID}/downloads`);
      expect(response.status).toBe(202);
    }

    const blocked = await request(app).post(`/folders/${FOLDER_ID}/downloads`);

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      code: 'rate_limit_exceeded',
      requestId: blocked.headers['x-request-id'],
    });
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['ratelimit-policy']).toContain('folder-download');
    expect(folderDownloadService.createDownload).toHaveBeenCalledTimes(10);
  });

  it.each(['queued', 'processing'] as const)(
    'returns no-store and Retry-After for the %s status',
    async (status) => {
      folderDownloadService.getStatus.mockResolvedValue({
        downloadId: DOWNLOAD_ID,
        fileName: 'Documents.zip',
        status,
      });

      const response = await request(
        createTestApp(userService, folderService, folderDownloadService),
      ).get(`/folders/downloads/${DOWNLOAD_ID}`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['retry-after']).toBe('2');
      expect(response.body).toStrictEqual({
        downloadId: DOWNLOAD_ID,
        fileName: 'Documents.zip',
        status,
      });
    },
  );

  it('does not return Retry-After for a terminal status', async () => {
    folderDownloadService.getStatus.mockResolvedValue({
      downloadId: DOWNLOAD_ID,
      fileName: 'Documents.zip',
      status: 'expired',
    });

    const response = await request(
      createTestApp(userService, folderService, folderDownloadService),
    ).get(`/folders/downloads/${DOWNLOAD_ID}`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['retry-after']).toBeUndefined();
  });

  it('does not apply the folder download creation limit to status polling', async () => {
    folderDownloadService.getStatus.mockResolvedValue({
      downloadId: DOWNLOAD_ID,
      fileName: 'Documents.zip',
      status: 'ready',
      sizeBytes: 12,
      downloadUrl: 'https://storage.example.test/download',
      expiresAt: '2026-01-01T00:05:00.000Z',
      expiresInSeconds: 60,
    });
    const app = createTestApp(userService, folderService, folderDownloadService, {
      ...PRINCIPAL,
      subject: 'folder-download-polling-user',
    });

    for (let index = 0; index < 11; index += 1) {
      const response = await request(app).get(`/folders/downloads/${DOWNLOAD_ID}`);
      expect(response.status).toBe(200);
    }

    expect(folderDownloadService.getStatus).toHaveBeenCalledTimes(11);
  });

  it('rejects invalid folder and download identifiers before service calls', async () => {
    const app = createTestApp(userService, folderService, folderDownloadService);

    const createResponse = await request(app).post('/folders/not-a-uuid/downloads');
    const statusResponse = await request(app).get('/folders/downloads/not-a-uuid');

    expect(createResponse.status).toBe(400);
    expect((createResponse.body as ErrorResponse).code).toBe('invalid_request_params');
    expect(statusResponse.status).toBe(400);
    expect((statusResponse.body as ErrorResponse).code).toBe('invalid_request_params');
    expect(folderDownloadService.createDownload).not.toHaveBeenCalled();
    expect(folderDownloadService.getStatus).not.toHaveBeenCalled();
  });
});

function createTestApp(
  userService: UserService,
  folderService: FolderService,
  folderDownloadService: FolderDownloadService,
  principal: AuthenticatedPrincipal = PRINCIPAL,
) {
  const app = express();

  app.use(requestContext);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = principal;
    next();
  });
  app.use('/folders', createFolderRouter({ userService, folderService, folderDownloadService }));
  app.use(errorHandler);

  return app;
}
