import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import type { EntryService } from '../../src/entry/entry-service.js';
import type { FolderDownloadService } from '../../src/folder/download/folder-download-service.js';
import { createFolderRouter } from '../../src/folder/folder-routes.js';
import {
  MAX_FOLDER_TREE_DEPTH,
  MAX_FOLDER_TREE_NODES,
  MAX_FOLDER_TREE_PATHS,
} from '../../src/folder/validation-schemas.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import type { User } from '../../src/user/user.js';

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
  let entryService: MockProxy<EntryService>;
  let folderDownloadService: MockProxy<FolderDownloadService>;

  beforeEach(() => {
    entryService = mock<EntryService>();
    folderDownloadService = mock<FolderDownloadService>();

    entryService.createFolder.mockResolvedValue({
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
    const response = await request(createTestApp(entryService, folderDownloadService))
      .post('/folders')
      .send({ name: ' Documents ' });

    expect(response.status).toBe(201);
    expect(response.headers['ratelimit-policy']).toContain('"entry-mutation"');
    expect(response.body).toStrictEqual({
      kind: 'folder',
      id: FOLDER_ID,
      name: 'Documents',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(entryService.createFolder).toHaveBeenCalledExactlyOnceWith(USER, {
      parentId: null,
      name: 'Documents',
    });
  });

  it.each(['.', '..', 'a/b', 'a\\b', 'bad\0folder', 'bad\rfolder'])(
    'rejects unsafe folder name %j before calling the service',
    async (name) => {
      const response = await request(createTestApp(entryService, folderDownloadService))
        .post('/folders')
        .send({ name });

      expect(response.status).toBe(400);
      expect((response.body as ErrorResponse).code).toBe('invalid_request_body');
      expect(entryService.createFolder).not.toHaveBeenCalled();
    },
  );

  it('accepts a folder download and returns polling headers', async () => {
    const response = await request(createTestApp(entryService, folderDownloadService)).post(
      `/folders/${FOLDER_ID}/downloads`,
    );

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
    const app = createTestApp(entryService, folderDownloadService, {
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

      const response = await request(createTestApp(entryService, folderDownloadService)).get(
        `/folders/downloads/${DOWNLOAD_ID}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers['ratelimit-policy']).toContain('"folder-download-status"');
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

    const response = await request(createTestApp(entryService, folderDownloadService)).get(
      `/folders/downloads/${DOWNLOAD_ID}`,
    );

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
    const app = createTestApp(entryService, folderDownloadService, {
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
    const app = createTestApp(entryService, folderDownloadService);

    const createResponse = await request(app).post('/folders/not-a-uuid/downloads');
    const statusResponse = await request(app).get('/folders/downloads/not-a-uuid');

    expect(createResponse.status).toBe(400);
    expect((createResponse.body as ErrorResponse).code).toBe('invalid_request_params');
    expect(statusResponse.status).toBe(400);
    expect((statusResponse.body as ErrorResponse).code).toBe('invalid_request_params');
    expect(folderDownloadService.createDownload).not.toHaveBeenCalled();
    expect(folderDownloadService.getStatus).not.toHaveBeenCalled();
  });

  it('ensures a folder tree, normalizes segments, and returns the relativePath map', async () => {
    entryService.ensureFolderTree.mockResolvedValue({
      folders: {
        Photos: FOLDER_ID,
        'Photos/2026': '20000000-0000-4000-8000-000000000002',
      },
    });

    const response = await request(createTestApp(entryService, folderDownloadService))
      .post('/folders/tree')
      .send({
        paths: [' Photos / 2026 ', 'Photos/2026'],
      });

    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-policy']).toContain('"folder-tree"');
    expect(response.body).toStrictEqual({
      folders: {
        Photos: FOLDER_ID,
        'Photos/2026': '20000000-0000-4000-8000-000000000002',
      },
    });
    expect(entryService.ensureFolderTree).toHaveBeenCalledExactlyOnceWith(USER, {
      parentId: null,
      paths: ['Photos/2026'],
    });
  });

  it.each([
    '',
    '/leading',
    'trailing/',
    'a//b',
    'a/./b',
    'a/../b',
    'a\\b',
    'a/bad\0name',
    'a/bad\nname',
    '   ',
    'a/   /b',
  ])('rejects invalid folder tree path %j before calling the service', async (badPath) => {
    const response = await request(createTestApp(entryService, folderDownloadService))
      .post('/folders/tree')
      .send({ paths: [badPath] });

    expect(response.status).toBe(400);
    expect((response.body as ErrorResponse).code).toBe('invalid_request_body');
    expect(entryService.ensureFolderTree).not.toHaveBeenCalled();
  });

  it('rejects empty paths, paths exceeding max depth, max path count, or max expanded nodes', async () => {
    const app = createTestApp(entryService, folderDownloadService);

    const emptyRes = await request(app).post('/folders/tree').send({ paths: [] });
    expect(emptyRes.status).toBe(400);
    expect((emptyRes.body as ErrorResponse).code).toBe('invalid_request_body');

    const tooDeepPath = Array.from({ length: MAX_FOLDER_TREE_DEPTH + 1 }, (_, i) => `d${i}`).join(
      '/',
    );
    const deepRes = await request(app)
      .post('/folders/tree')
      .send({ paths: [tooDeepPath] });
    expect(deepRes.status).toBe(400);
    expect((deepRes.body as ErrorResponse).code).toBe('invalid_request_body');

    const tooManyPaths = Array.from({ length: MAX_FOLDER_TREE_PATHS + 1 }, (_, i) => `f${i}`);
    const manyPathsRes = await request(app).post('/folders/tree').send({ paths: tooManyPaths });
    expect(manyPathsRes.status).toBe(400);
    expect((manyPathsRes.body as ErrorResponse).code).toBe('invalid_request_body');

    // 50 disjoint chains of depth 5 -> 250 nodes; 500 disjoint chains of depth 5 -> 2500 > 2000 nodes
    const tooManyNodes = Array.from(
      { length: Math.ceil(MAX_FOLDER_TREE_NODES / 5) + 1 },
      (_, i) => `r${i}/a/b/c/d`,
    );
    const manyNodesRes = await request(app).post('/folders/tree').send({ paths: tooManyNodes });
    expect(manyNodesRes.status).toBe(400);
    expect((manyNodesRes.body as ErrorResponse).code).toBe('invalid_request_body');

    expect(entryService.ensureFolderTree).not.toHaveBeenCalled();
  });

  it('maps folder_path_conflict to 409 and folder_depth_limit_exceeded to 400', async () => {
    const app = createTestApp(entryService, folderDownloadService);

    entryService.ensureFolderTree.mockRejectedValueOnce(new AppError('folder_path_conflict'));
    const conflictRes = await request(app)
      .post('/folders/tree')
      .send({ paths: ['Photos/existing-file'] });
    expect(conflictRes.status).toBe(409);
    expect((conflictRes.body as ErrorResponse).code).toBe('folder_path_conflict');

    entryService.ensureFolderTree.mockRejectedValueOnce(
      new AppError('folder_depth_limit_exceeded'),
    );
    const depthRes = await request(app)
      .post('/folders/tree')
      .send({ parentId: FOLDER_ID, paths: ['sub/deep'] });
    expect(depthRes.status).toBe(400);
    expect((depthRes.body as ErrorResponse).code).toBe('folder_depth_limit_exceeded');
  });
});

function createTestApp(
  entryService: EntryService,
  folderDownloadService: FolderDownloadService,
  principal: AuthenticatedPrincipal = PRINCIPAL,
) {
  const app = express();

  app.use(requestContext);
  app.use((req, _res, next) => {
    req.principal = principal;
    req.user = USER;
    next();
  });
  app.use('/folders', createFolderRouter({ entryService, folderDownloadService }));
  app.use(errorHandler);

  return app;
}
