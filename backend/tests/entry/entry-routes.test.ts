import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthenticatedPrincipal } from '../../src/auth/authenticated-principal.js';
import { createEntryRouter } from '../../src/entry/entry-routes.js';
import type { EntryService } from '../../src/entry/entry-service.js';
import { ConflictError } from '../../src/shared/errors/conflict-error.js';
import { errorHandler } from '../../src/shared/validation/error-handler.js';
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
    entryService.updateEntry.mockResolvedValue({
      kind: 'folder',
      id: ENTRY_ID,
      name: 'Renamed',
      updatedAt: '2026-01-01T00:00:00.000Z',
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

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'invalid_request_body',
      error: 'Invalid request body',
    });
    expect(entryService.updateEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['itself', ENTRY_ID, 'Folder cannot be moved into itself'],
    ['a descendant', DESCENDANT_FOLDER_ID, 'Folder cannot be moved into its descendant'],
  ])('returns conflict when moving a folder into %s', async (_case, parentId, message) => {
    entryService.updateEntry.mockRejectedValueOnce(new ConflictError(message));

    const response = await request(createTestApp(userService, entryService))
      .patch(`/entries/${ENTRY_ID}`)
      .send({ parentId });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({
      code: 'conflict',
      error: message,
    });
    expect(entryService.updateEntry).toHaveBeenCalledExactlyOnceWith(USER, ENTRY_ID, {
      parentId,
    });
  });
});

function createTestApp(userService: UserService, entryService: EntryService) {
  const app = express();

  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = PRINCIPAL;
    next();
  });
  app.use('/entries', createEntryRouter({ userService, entryService }));
  app.use(errorHandler);

  return app;
}
