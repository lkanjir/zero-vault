import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import { createEntryRouter } from '../../src/entry/entry-routes.js';
import type { EntryService } from '../../src/entry/entry-service.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';
import type { ErrorResponse } from '../../src/shared/errors/api/error-response.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { requestContext } from '../../src/shared/http/request-context.js';
import type { User } from '../../src/user/user.js';
import type { UserService } from '../../src/user/user-service.js';

const ENTRY_ID = '20000000-0000-4000-8000-000000000001';
const DESCENDANT_FOLDER_ID = '20000000-0000-4000-8000-000000000002';
const ROOT_PARENT = null;

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

describe('entry routes', () => {
  let userService: MockProxy<UserService>;
  let entryService: MockProxy<EntryService>;

  beforeEach(() => {
    userService = mock<UserService>();
    entryService = mock<EntryService>();

    userService.resolveUser.mockResolvedValue(USER);
    entryService.listEntries.mockResolvedValue({
      items: [],
      path: [],
      page: {
        hasMore: false,
        limit: 50,
        nextCursor: null,
      },
    });
    entryService.updateEntry.mockResolvedValue({
      kind: 'folder',
      id: ENTRY_ID,
      name: 'Renamed',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('lists the root with the default cursor page contract', async () => {
    const response = await request(createTestApp(userService, entryService)).get('/entries');

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      items: [],
      path: [],
      page: {
        hasMore: false,
        limit: 50,
        nextCursor: null,
      },
    });
    expect(entryService.listEntries).toHaveBeenCalledExactlyOnceWith(USER, {
      parentId: null,
      cursor: null,
      limit: 50,
    });
  });

  it('passes the parent, cursor and limit query to the listing service', async () => {
    const response = await request(createTestApp(userService, entryService)).get('/entries').query({
      parentId: ENTRY_ID,
      cursor: 'cursor-value',
      limit: 25,
    });

    expect(response.status).toBe(200);
    expect(entryService.listEntries).toHaveBeenCalledExactlyOnceWith(USER, {
      parentId: ENTRY_ID,
      cursor: 'cursor-value',
      limit: 25,
    });
  });

  it('renames an entry without adding parentId to the update request', async () => {
    const response = await request(createTestApp(userService, entryService))
      .patch(`/entries/${ENTRY_ID}`)
      .send({ name: ' Renamed ' });

    expect(response.status).toBe(200);
    expect(entryService.updateEntry).toHaveBeenCalledExactlyOnceWith(USER, ENTRY_ID, {
      name: 'Renamed',
    });

    const [, , updateRequest] = entryService.updateEntry.mock.lastCall!;
    expect(updateRequest).not.toHaveProperty('parentId');
  });

  it('passes explicit null parentId when moving an entry to root', async () => {
    const response = await request(createTestApp(userService, entryService))
      .patch(`/entries/${ENTRY_ID}`)
      .send({ parentId: ROOT_PARENT });

    expect(response.status).toBe(200);
    expect(entryService.updateEntry).toHaveBeenCalledExactlyOnceWith(USER, ENTRY_ID, {
      parentId: ROOT_PARENT,
    });
  });

  it('rejects an empty update body', async () => {
    const response = await request(createTestApp(userService, entryService))
      .patch(`/entries/${ENTRY_ID}`)
      .send({});
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: 'invalid_request_body',
      message: 'Podaci zahtjeva nisu ispravni.',
    });
    expect(typeof body.requestId).toBe('string');
    expect(Array.isArray(body.details?.issues)).toBe(true);
    expect(entryService.updateEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['itself', ENTRY_ID],
    ['a descendant', DESCENDANT_FOLDER_ID],
  ])('returns conflict when moving a folder into %s', async (_case, parentId) => {
    entryService.updateEntry.mockRejectedValueOnce(new AppError('move_would_create_cycle'));

    const response = await request(createTestApp(userService, entryService))
      .patch(`/entries/${ENTRY_ID}`)
      .send({ parentId });
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(409);
    expect(body).toStrictEqual({
      code: 'move_would_create_cycle',
      message:
        'Direktorij nije moguće premjestiti u samog sebe ili neki od njegovih poddirektorija.',
      requestId: body.requestId,
    });
    expect(typeof body.requestId).toBe('string');
    expect(entryService.updateEntry).toHaveBeenCalledExactlyOnceWith(USER, ENTRY_ID, {
      parentId,
    });
  });

  it('deletes an entry and returns no response body', async () => {
    const response = await request(createTestApp(userService, entryService)).delete(
      `/entries/${ENTRY_ID}`,
    );

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(entryService.deleteEntry).toHaveBeenCalledExactlyOnceWith(USER, ENTRY_ID);
  });

  it('returns folder_not_empty when a non-empty folder cannot be deleted', async () => {
    entryService.deleteEntry.mockRejectedValueOnce(new AppError('folder_not_empty'));

    const response = await request(createTestApp(userService, entryService)).delete(
      `/entries/${ENTRY_ID}`,
    );
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(409);
    expect(body).toStrictEqual({
      code: 'folder_not_empty',
      message: 'Direktorij nije moguće obrisati jer nije prazan.',
      requestId: body.requestId,
    });
    expect(typeof body.requestId).toBe('string');
  });

  it('rejects an invalid delete entryId before calling the service', async () => {
    const response = await request(createTestApp(userService, entryService)).delete(
      '/entries/not-a-uuid',
    );

    expect(response.status).toBe(400);
    expect(entryService.deleteEntry).not.toHaveBeenCalled();
  });
});

function createTestApp(userService: UserService, entryService: EntryService) {
  const app = express();

  app.use(requestContext);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    next();
  });
  app.use('/entries', createEntryRouter({ userService, entryService }));
  app.use(errorHandler);

  return app;
}
