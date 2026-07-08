import type { User } from '../user/user.js';
import { decodeCursor, encodeCursor } from './entry-list-cursor.js';
import type { EntryRepository, ListedEntry } from './entry-repository.js';
import { BadRequestError } from '../shared/errors/bad-request-error.js';
import type { EntryResponse, EntryListResponse } from './dto.js';
import type { EntriesListRequest, EntryUpdateRequest } from './validation-schemas.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';

export class EntryService {
  constructor(private readonly entryRepository: EntryRepository) {}

  async listEntries(user: User, request: EntriesListRequest): Promise<EntryListResponse> {
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;

    if (cursor && cursor.parentId !== request.parentId) {
      throw new BadRequestError('Cursor does not belong to this folder');
    }

    const entries = await this.entryRepository.getEntries({
      cursor: cursor,
      limit: request.limit + 1,
      ownerId: user.id,
      parentId: request.parentId,
    });

    const pageEntries = entries.slice(0, request.limit);
    const hasMore = entries.length > request.limit;
    const lastEntry = pageEntries.at(-1);

    const nextCursor =
      hasMore && lastEntry
        ? encodeCursor({ v: 1, parentId: request.parentId, ...lastEntry.cursor })
        : null;

    return {
      items: pageEntries.map((row) => this.toResponseItem(row.entry)),
      page: {
        hasMore: hasMore,
        limit: request.limit,
        nextCursor: nextCursor,
      },
      parentId: request.parentId,
    };
  }

  async updateEntry(
    user: User,
    entryId: string,
    request: EntryUpdateRequest,
  ): Promise<EntryResponse> {
    const updatedEntry = await this.entryRepository.updateEntry({
      entryId: entryId,
      ownerId: user.id,
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.parentId !== undefined ? { parentId: request.parentId } : {}),
    });

    if (!updatedEntry) {
      throw new NotFoundError('File / folder not found');
    }

    return this.toResponseItem(updatedEntry);
  }

  private toResponseItem(entry: ListedEntry): EntryResponse {
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
}
