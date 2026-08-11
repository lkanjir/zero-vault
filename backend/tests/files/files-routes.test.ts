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
import type { UploadService } from '../../src/upload/upload-service.js';

const FILE_ID = '20000000-0000-4000-8000-000000000001';
const SHARE_ID = '30000000-0000-4000-8000-000000000001';
const DOWNLOAD_URL = 'https://storage.example.test/download';
const EXPECTED_SHA256 = 'a'.repeat(64);

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

describe('files routes', () => {
  let userService: MockProxy<UserService>;
  let downloadService: MockProxy<FileDownloadService>;
  let sharingService: MockProxy<FileSharingService>;
  let uploadService: MockProxy<UploadService>;

  beforeEach(() => {
    userService = mock<UserService>();
    downloadService = mock<FileDownloadService>();
    sharingService = mock<FileSharingService>();
    uploadService = mock<UploadService>();

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
    sharingService.updateFileShare.mockResolvedValue({
      shareId: SHARE_ID,
      recipientEmail: 'recipient@example.com',
      permission: 'editor',
      expiresAt: null,
    });
    uploadService.createReplacementUpload.mockResolvedValue({
      uploadId: '40000000-0000-4000-8000-000000000001',
      uploadUrl: 'https://storage.example.test/upload',
      expiresInSeconds: 60,
      requiredHeaders: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-sha256': Buffer.from(EXPECTED_SHA256, 'hex').toString('base64'),
      },
    });
    sharingService.listSharedFiles.mockResolvedValue({
      items: [
        {
          kind: 'file',
          id: FILE_ID,
          name: 'shared.txt',
          contentType: 'text/plain',
          sizeBytes: 12,
          updatedAt: '2026-08-01T10:00:00.000Z',
          owner: {
            email: 'owner@example.com',
            firstName: 'Other',
            lastName: 'Owner',
          },
          expiresAt: null,
          access: {
            accessLevel: 'viewer',
            capabilities: {
              download: true,
              rename: false,
              replaceContent: false,
              move: false,
              delete: false,
              manageSharing: false,
            },
          },
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

  it('creates a replacement upload intent for a valid file', async () => {
    const response = await request(
      createTestApp(userService, downloadService, sharingService, uploadService),
    )
      .post(`/files/${FILE_ID}/replacements`)
      .send({
        contentType: ' Application/PDF; charset=binary ',
        size: 24,
        sha256: EXPECTED_SHA256.toUpperCase(),
      });

    expect(response.status).toBe(201);
    expect(response.body).toStrictEqual({
      uploadId: '40000000-0000-4000-8000-000000000001',
      uploadUrl: 'https://storage.example.test/upload',
      expiresInSeconds: 60,
      requiredHeaders: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-sha256': Buffer.from(EXPECTED_SHA256, 'hex').toString('base64'),
      },
    });
    expect(uploadService.createReplacementUpload).toHaveBeenCalledExactlyOnceWith(USER, FILE_ID, {
      contentType: 'application/pdf',
      size: 24,
      sha256: EXPECTED_SHA256,
    });
  });

  it.each([
    ['an invalid file ID', '/files/not-a-uuid/replacements', validReplacementBody()],
    [
      'an invalid content type',
      `/files/${FILE_ID}/replacements`,
      validReplacementBody({ contentType: '; charset=utf-8' }),
    ],
    ['an invalid size', `/files/${FILE_ID}/replacements`, validReplacementBody({ size: 0 })],
    [
      'an oversized replacement',
      `/files/${FILE_ID}/replacements`,
      validReplacementBody({ size: 100 * 1024 * 1024 + 1 }),
    ],
    [
      'an invalid checksum',
      `/files/${FILE_ID}/replacements`,
      validReplacementBody({ sha256: 'invalid' }),
    ],
  ])('rejects %s before creating a replacement intent', async (_case, url, body) => {
    const response = await request(
      createTestApp(userService, downloadService, sharingService, uploadService),
    )
      .post(url)
      .send(body);

    expect(response.status).toBe(400);
    expect(uploadService.createReplacementUpload).not.toHaveBeenCalled();
  });

  it('preserves a hidden replacement authorization failure', async () => {
    uploadService.createReplacementUpload.mockRejectedValue(new AppError('entry_not_found'));

    const response = await request(
      createTestApp(userService, downloadService, sharingService, uploadService),
    )
      .post(`/files/${FILE_ID}/replacements`)
      .send(validReplacementBody());

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'entry_not_found' });
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

  it('revokes a file share and returns an empty response', async () => {
    const response = await request(
      createTestApp(userService, downloadService, sharingService),
    ).delete(`/files/${FILE_ID}/shares/${SHARE_ID}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(sharingService.revokeFileShare).toHaveBeenCalledExactlyOnceWith(USER, FILE_ID, SHARE_ID);
  });

  it.each([
    ['an invalid file ID', `/files/not-a-uuid/shares/${SHARE_ID}`],
    ['an invalid share ID', `/files/${FILE_ID}/shares/not-a-uuid`],
  ])('rejects %s before revoking a file share', async (_case, url) => {
    const response = await request(
      createTestApp(userService, downloadService, sharingService),
    ).delete(url);

    expect(response.status).toBe(400);
    expect(sharingService.revokeFileShare).not.toHaveBeenCalled();
  });

  it('preserves a hidden authorization failure when revoking a file share', async () => {
    sharingService.revokeFileShare.mockRejectedValue(new AppError('entry_not_found'));

    const response = await request(
      createTestApp(userService, downloadService, sharingService),
    ).delete(`/files/${FILE_ID}/shares/${SHARE_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: 'entry_not_found',
    });
  });

  it('updates a file share and returns the resulting representation', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .patch(`/files/${FILE_ID}/shares/${SHARE_ID}`)
      .send({ permission: 'editor' });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      shareId: SHARE_ID,
      recipientEmail: 'recipient@example.com',
      permission: 'editor',
      expiresAt: null,
    });
    expect(sharingService.updateFileShare).toHaveBeenCalledExactlyOnceWith(
      USER,
      FILE_ID,
      SHARE_ID,
      { permission: 'editor' },
    );
  });

  it('converts an updated ISO expiry with an offset to a Date', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .patch(`/files/${FILE_ID}/shares/${SHARE_ID}`)
      .send({ expiresAt: '2026-08-10T12:30:00+02:00' });

    expect(response.status).toBe(200);
    expect(sharingService.updateFileShare).toHaveBeenCalledExactlyOnceWith(
      USER,
      FILE_ID,
      SHARE_ID,
      { expiresAt: new Date('2026-08-10T10:30:00.000Z') },
    );
  });

  it('passes a null updated expiry through to the sharing service', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .patch(`/files/${FILE_ID}/shares/${SHARE_ID}`)
      .send({ expiresAt: null });

    expect(response.status).toBe(200);
    expect(sharingService.updateFileShare).toHaveBeenCalledExactlyOnceWith(
      USER,
      FILE_ID,
      SHARE_ID,
      { expiresAt: null },
    );
  });

  it.each([
    ['an empty body', {}],
    ['an invalid permission', { permission: 'owner' }],
    ['an invalid expiry', { expiresAt: 'tomorrow' }],
  ])('rejects %s before updating a file share', async (_case, body) => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .patch(`/files/${FILE_ID}/shares/${SHARE_ID}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'invalid_request_body' });
    expect(sharingService.updateFileShare).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid file ID', `/files/not-a-uuid/shares/${SHARE_ID}`],
    ['an invalid share ID', `/files/${FILE_ID}/shares/not-a-uuid`],
  ])('rejects %s before updating a file share', async (_case, url) => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .patch(url)
      .send({ permission: 'editor' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'invalid_request_params' });
    expect(sharingService.updateFileShare).not.toHaveBeenCalled();
  });

  it('maps a missing file share from the sharing service to 404', async () => {
    sharingService.updateFileShare.mockRejectedValue(new AppError('file_share_not_found'));

    const response = await request(createTestApp(userService, downloadService, sharingService))
      .patch(`/files/${FILE_ID}/shares/${SHARE_ID}`)
      .send({ permission: 'editor' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'file_share_not_found' });
  });

  it('lists files shared with the authenticated user using the default page request', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService)).get(
      '/files/shared-with-me',
    );

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      items: [
        {
          kind: 'file',
          id: FILE_ID,
          name: 'shared.txt',
          contentType: 'text/plain',
          sizeBytes: 12,
          updatedAt: '2026-08-01T10:00:00.000Z',
          owner: {
            email: 'owner@example.com',
            firstName: 'Other',
            lastName: 'Owner',
          },
          expiresAt: null,
          access: {
            accessLevel: 'viewer',
            capabilities: {
              download: true,
              rename: false,
              replaceContent: false,
              move: false,
              delete: false,
              manageSharing: false,
            },
          },
        },
      ],
      page: {
        limit: 50,
        hasMore: false,
        nextCursor: null,
      },
    });
    expect(sharingService.listSharedFiles).toHaveBeenCalledExactlyOnceWith(USER, {
      cursor: null,
      limit: 50,
    });
  });

  it('passes a normalized shared-file page request to the sharing service', async () => {
    const response = await request(createTestApp(userService, downloadService, sharingService))
      .get('/files/shared-with-me')
      .query({ cursor: ' next-page ', limit: '25' });

    expect(response.status).toBe(200);
    expect(sharingService.listSharedFiles).toHaveBeenCalledExactlyOnceWith(USER, {
      cursor: 'next-page',
      limit: 25,
    });
  });

  it.each([
    ['an invalid page limit', '/files/shared-with-me?limit=101'],
    ['an empty cursor', '/files/shared-with-me?cursor=%20%20%20'],
  ])('rejects %s before listing shared files', async (_case, url) => {
    const response = await request(createTestApp(userService, downloadService, sharingService)).get(
      url,
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'invalid_request_query' });
    expect(sharingService.listSharedFiles).not.toHaveBeenCalled();
  });
});

function createTestApp(
  userService: UserService,
  downloadService: FileDownloadService,
  sharingService: FileSharingService,
  uploadService: UploadService = mock<UploadService>(),
) {
  const app = express();

  app.use(requestContext);
  app.use(express.json({ limit: '16kb' }));
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    next();
  });
  app.use(
    '/files',
    createFilesRouter({ userService, downloadService, sharingService, uploadService }),
  );
  app.use(errorHandler);

  return app;
}

function validReplacementBody(overrides: Record<string, unknown> = {}) {
  return {
    contentType: 'application/pdf',
    size: 24,
    sha256: EXPECTED_SHA256,
    ...overrides,
  };
}
