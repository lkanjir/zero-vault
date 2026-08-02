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
import type { FileSharingService } from '../../src/sharing/file-sharing-service.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';

const FILE_ID = '20000000-0000-4000-8000-000000000001';
const DOWNLOAD_URL = 'https://storage.example.test/download';

const PRINCIPAL: AuthenticatedPrincipal = {
  issuer: process.env['OIDC_ISSUER']!,
  subject: 'user-123',
  email: 'test@example.com',
  username: 'test',
};

const USER: User = {
  id: 1,
  publicId: '10000000-0000-4000-8000-000000000001',
  issuer: PRINCIPAL.issuer,
  subject: PRINCIPAL.subject,
  username: PRINCIPAL.username!,
  email: PRINCIPAL.email,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

describe('files routes', () => {
  let userService: MockProxy<UserService>;
  let downloadService: MockProxy<FileDownloadService>;
  let sharingService: MockProxy<FileSharingService>;

  beforeEach(() => {
    userService = mock<UserService>();
    downloadService = mock<FileDownloadService>();
    sharingService = mock<FileSharingService>();

    userService.resolveUser.mockResolvedValue(USER);
    downloadService.createDownloadUrl.mockResolvedValue({
      fileId: FILE_ID,
      fileName: 'document.txt',
      contentType: 'text/plain',
      sizeBytes: 12,
      downloadUrl: DOWNLOAD_URL,
      expiresInSeconds: 60,
    });
    sharingService.listFileShares.mockResolvedValue({
      items: [
        {
          shareId: '30000000-0000-4000-8000-000000000001',
          recipientEmail: 'recipient@example.com',
          permission: 'viewer',
          expiresAt: null,
        },
      ],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
  });

  it('creates a download URL for the fileId route parameter', async () => {
    const response = await request(
      createTestApp(userService, downloadService, sharingService),
    ).post(`/files/${FILE_ID}/download-url`);

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
    const response = await request(
      createTestApp(userService, downloadService, sharingService),
    ).post('/files/not-a-uuid/download-url');
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

  it('accepts a share request without disclosing recipient state', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .post(`/files/${FILE_ID}/shares`)
      .send({
        recipientEmail: ' Recipient@Example.COM ',
        permission: 'viewer',
      });

    expect(response.status).toBe(202);
    expect(response.body).toStrictEqual({ status: 'accepted' });
    expect(sharingService.shareFile).toHaveBeenCalledExactlyOnceWith(USER, FILE_ID, {
      recipientEmail: 'recipient@example.com',
      permission: 'viewer',
      expiresAt: null,
    });
  });

  it('converts an ISO expiry with an offset to a Date', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .post(`/files/${FILE_ID}/shares`)
      .send({
        recipientEmail: 'recipient@example.com',
        permission: 'editor',
        expiresAt: '2026-08-10T12:30:00+02:00',
      });

    expect(response.status).toBe(202);
    expect(sharingService.shareFile).toHaveBeenCalledExactlyOnceWith(USER, FILE_ID, {
      recipientEmail: 'recipient@example.com',
      permission: 'editor',
      expiresAt: new Date('2026-08-10T10:30:00.000Z'),
    });
  });

  it.each([
    ['invalid email', { recipientEmail: 'invalid', permission: 'viewer' }],
    ['invalid permission', { recipientEmail: 'recipient@example.com', permission: 'owner' }],
    [
      'invalid expiry',
      {
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
        expiresAt: 'tomorrow',
      },
    ],
  ])('rejects an %s before calling the sharing service', async (_case, body) => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .post(`/files/${FILE_ID}/shares`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'invalid_request_body',
    });
    expect(sharingService.shareFile).not.toHaveBeenCalled();
  });

  it('rejects an invalid share fileId before calling the sharing service', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .post('/files/not-a-uuid/shares')
      .send({
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'invalid_request_params',
    });
    expect(sharingService.shareFile).not.toHaveBeenCalled();
  });

  it('preserves a hidden authorization failure from the sharing service', async () => {
    sharingService.shareFile.mockRejectedValue(new AppError('entry_not_found'));

    const response = await request(createTestApp(userService, downloadService, sharingService))
      .post(`/files/${FILE_ID}/shares`)
      .send({
        recipientEmail: 'recipient@example.com',
        permission: 'viewer',
      });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: 'entry_not_found',
    });
  });

  it('lists file shares with the default page request', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService)).get(
      `/files/${FILE_ID}/shares`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      items: [
        {
          shareId: '30000000-0000-4000-8000-000000000001',
          recipientEmail: 'recipient@example.com',
          permission: 'viewer',
          expiresAt: null,
        },
      ],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
    expect(sharingService.listFileShares).toHaveBeenCalledExactlyOnceWith(USER, FILE_ID, {
      cursor: null,
      limit: 50,
    });
  });

  it('passes a normalized cursor page request to the sharing service', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .get(`/files/${FILE_ID}/shares`)
      .query({ cursor: ' next-page ', limit: '25' });

    expect(response.status).toBe(200);
    expect(sharingService.listFileShares).toHaveBeenCalledExactlyOnceWith(USER, FILE_ID, {
      cursor: 'next-page',
      limit: 25,
    });
  });

  it.each([
    ['an invalid file ID', '/files/not-a-uuid/shares'],
    ['an invalid page limit', `/files/${FILE_ID}/shares?limit=0`],
    ['an empty cursor', `/files/${FILE_ID}/shares?cursor=%20%20%20`],
  ])('rejects %s before listing file shares', async (_case, url) => {
    const response = await request(createTestApp(userService, downloadService, sharingService)).get(
      url,
    );

    expect(response.status).toBe(400);
    expect(sharingService.listFileShares).not.toHaveBeenCalled();
  });
});

function createTestApp(
  userService: UserService,
  downloadService: FileDownloadService,
  sharingService: FileSharingService,
) {
  const app = express();

  app.use(requestContext);
  app.use(express.json({ limit: '16kb' }));
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    next();
  });
  app.use('/files', createFilesRouter({ userService, downloadService, sharingService }));
  app.use(errorHandler);

  return app;
}
