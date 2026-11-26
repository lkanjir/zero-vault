import type { AuditRepository } from '../audit/audit-repository.js';
import type { AuthorizationAction } from '../authorization/authorization.js';
import type { EntryAccessMapper } from '../authorization/entry-access-mapper.js';
import type { EntryAuthorizer } from '../authorization/entry-authorizer.js';
import type { UnitOfWork } from '../db/unit-of-work.js';
import type { FileResponse } from '../files/dto.js';
import type { FolderResponse } from '../folder/dto.js';
import type { CreateFolderRequestBody } from '../folder/validation-schemas.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type { User } from '../user/user.js';
import type { EntryListResponse, EntryResponse } from './dto.js';
import { decodeCursor, encodeCursor } from './entry-list-cursor.js';
import type { EntryListRecord, EntryRepository, ListedEntry } from './entry-repository.js';
import type { EntriesListRequest, EntryUpdateRequest } from './validation-schemas.js';

type BaseEntryResponse = FolderResponse | FileResponse;

export class EntryService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly entryAuthorizer: EntryAuthorizer,
    private readonly entryRepository: EntryRepository,
    private readonly auditRepository: AuditRepository,
    private readonly accessMapper: EntryAccessMapper,
  ) {}

  async listEntries(user: User, request: EntriesListRequest): Promise<EntryListResponse> {
    const projectedAt = new Date();
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;

    if (
      cursor &&
      (cursor.parentId !== request.parentId ||
        cursor.search !== request.search ||
        cursor.kind !== request.kind ||
        cursor.sort !== request.sort)
    ) {
      throw new AppError('invalid_cursor');
    }

    const entriesResult = await this.entryRepository.getEntries({
      cursor,
      limit: request.limit + 1,
      ownerId: user.id,
      parentId: request.parentId,
      search: request.search,
      kind: request.kind,
      sort: request.sort,
    });

    const pageEntries = entriesResult.entries.slice(0, request.limit);
    const hasMore = entriesResult.entries.length > request.limit;
    const lastEntry = pageEntries.at(-1);

    const nextCursor =
      hasMore && lastEntry
        ? encodeCursor({
            v: 2,
            parentId: request.parentId,
            sort: request.sort,
            kind: request.kind,
            search: request.search,
            ...lastEntry.cursor,
          })
        : null;

    return {
      items: pageEntries.map((record) => this.toListResponseItem(user.id, record, projectedAt)),
      path: entriesResult.path,
      page: {
        hasMore,
        limit: request.limit,
        nextCursor,
      },
    };
  }

  async createFolder(user: User, request: CreateFolderRequestBody): Promise<FolderResponse> {
    const createdFolder = await this.unitOfWork.run(async (tx) => {
      const parentId = await this.entryAuthorizer.authorizeParentForCreate(
        {
          actorUserId: user.id,
          ownerId: user.id,
          parentPublicId: request.parentId,
        },
        tx,
      );

      const folder = await this.entryRepository.createFolder(
        {
          ownerId: user.id,
          parentId,
          name: request.name,
        },
        tx,
      );

      await this.auditRepository.record(
        {
          ownerId: folder.ownerId,
          actorUserId: user.id,
          entryId: folder.id,
          entryNameSnapshot: folder.name,
          action: 'folder.created',
          occurredAt: folder.createdAt,
        },
        tx,
      );

      return folder;
    });

    return {
      kind: createdFolder.kind,
      id: createdFolder.publicId,
      name: createdFolder.name,
      updatedAt: createdFolder.updatedAt.toISOString(),
    };
  }

  async updateEntry(
    user: User,
    entryId: string,
    request: EntryUpdateRequest,
  ): Promise<EntryResponse> {
    const actions: AuthorizationAction[] = [];

    if (request.name !== undefined) {
      actions.push('entry:rename');
    }

    if (request.parentId !== undefined) {
      actions.push('entry:move');
    }

    return this.unitOfWork.run(async (tx) => {
      const authorized = await this.entryAuthorizer.authorizeForUpdate(
        {
          actorUserId: user.id,
          entryPublicId: entryId,
          actions,
        },
        tx,
      );
      const sourceEntry = authorized.entry;

      const nextParentId =
        request.parentId === undefined
          ? sourceEntry.parentId
          : await this.entryAuthorizer.authorizeParentForCreate(
              {
                actorUserId: user.id,
                ownerId: sourceEntry.ownerId,
                parentPublicId: request.parentId,
              },
              tx,
            );

      if (sourceEntry.kind === 'folder' && request.parentId !== undefined) {
        await this.entryRepository.assertFolderCanMove(sourceEntry.id, nextParentId, tx);
      }

      const updated = await this.entryRepository.updateEntry(
        {
          entryId: sourceEntry.id,
          ownerId: sourceEntry.ownerId,
          updatedAt: new Date(),
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.parentId !== undefined ? { parentId: nextParentId } : {}),
        },
        tx,
      );

      if (request.name !== undefined && updated.entry.name !== sourceEntry.name) {
        await this.auditRepository.record(
          {
            ownerId: updated.entry.ownerId,
            actorUserId: user.id,
            entryId: updated.entry.id,
            entryNameSnapshot: updated.entry.name,
            action: 'entry.renamed',
            details: {
              previousName: sourceEntry.name,
            },
            occurredAt: updated.entry.updatedAt,
          },
          tx,
        );
      }

      if (request.parentId !== undefined && updated.entry.parentId !== sourceEntry.parentId) {
        const sourceParent =
          sourceEntry.parentId === null
            ? null
            : await this.entryRepository.resolveParentContext(
                sourceEntry.ownerId,
                sourceEntry.parentId,
                tx,
              );

        const destinationParent =
          updated.entry.parentId === null
            ? null
            : await this.entryRepository.resolveParentContext(
                updated.entry.ownerId,
                updated.entry.parentId,
                tx,
              );

        await this.auditRepository.record(
          {
            ownerId: updated.entry.ownerId,
            actorUserId: user.id,
            entryId: updated.entry.id,
            entryNameSnapshot: updated.entry.name,
            action: 'entry.moved',
            details: {
              sourceParentId: sourceParent?.publicId ?? null,
              sourceParentName: sourceParent?.name ?? null,
              destinationParentId: destinationParent?.publicId ?? null,
              destinationParentName: destinationParent?.name ?? null,
            },
            occurredAt: updated.entry.updatedAt,
          },
          tx,
        );
      }

      return {
        ...this.toBaseEntryResponse(updated.listedEntry),
        access: this.accessMapper.map(authorized.context),
      };
    });
  }

  async deleteEntry(user: User, entryId: string): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      const { entry } = await this.entryAuthorizer.authorizeForUpdate(
        {
          actorUserId: user.id,
          entryPublicId: entryId,
          actions: ['entry:delete'],
        },
        tx,
      );

      const deletedAt = new Date();
      await this.entryRepository.deleteEntry({ entry, deletedAt }, tx);

      await this.auditRepository.record(
        {
          ownerId: entry.ownerId,
          actorUserId: user.id,
          entryId: entry.id,
          entryNameSnapshot: entry.name,
          action: 'entry.deleted',
          occurredAt: deletedAt,
        },
        tx,
      );
    });
  }

  private toBaseEntryResponse(entry: ListedEntry): BaseEntryResponse {
    if (entry.kind === 'folder') {
      return {
        kind: 'folder',
        id: entry.id,
        name: entry.name,
        updatedAt: entry.updatedAt.toISOString(),
      };
    }

    return {
      contentType: entry.contentType,
      id: entry.id,
      kind: 'file',
      name: entry.name,
      sizeBytes: entry.sizeBytes,
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  private toListResponseItem(
    actorUserId: number,
    record: EntryListRecord,
    now: Date,
  ): EntryResponse {
    const access = this.accessMapper.map({
      scope: 'entry',
      actor: { userId: actorUserId },
      resource: {
        id: record.cursor.entryId,
        ownerId: actorUserId,
        kind: record.entry.kind,
        deletedAt: null,
      },
      relationship: { grant: null },
      environment: { now },
    });

    return { ...this.toBaseEntryResponse(record.entry), access };
  }
}
