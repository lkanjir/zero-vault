import type { User } from '../user/user.js';
import { decodeCursor, encodeCursor } from './entry-list-cursor.js';
import type { EntryRepository, ListedEntry } from './entry-repository.js';
import type { EntryResponse, EntryListResponse } from './dto.js';
import type { EntriesListRequest, EntryUpdateRequest } from './validation-schemas.js';
import { AppError } from '../shared/errors/api/app-error.js';

export class EntryService {
  constructor(private readonly entryRepository: EntryRepository) {}

  async listEntries(user: User, request: EntriesListRequest): Promise<EntryListResponse> {
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;

    if (cursor && cursor.parentId !== request.parentId) {
      throw new AppError('cursor_parent_mismatch', {
        context: {
          cursorParentId: cursor.parentId,
          requestedParentId: request.parentId,
        },
      });
    }

    const entriesResult = await this.entryRepository.getEntries({
      cursor: cursor,
      limit: request.limit + 1,
      ownerId: user.id,
      parentId: request.parentId,
    });

    const pageEntries = entriesResult.entries.slice(0, request.limit);
    const hasMore = entriesResult.entries.length > request.limit;
    const lastEntry = pageEntries.at(-1);

    const nextCursor =
      hasMore && lastEntry
        ? encodeCursor({ v: 1, parentId: request.parentId, ...lastEntry.cursor })
        : null;

    return {
      items: pageEntries.map((row) => this.toResponseItem(row.entry)),
      path: entriesResult.path,
      page: {
        hasMore: hasMore,
        limit: request.limit,
        nextCursor: nextCursor,
      },
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
      throw new AppError('entry_not_found');
    }

    return this.toResponseItem(updatedEntry);
  }

  async deleteEntry(user: User, entryId: string): Promise<void> {
    await this.entryRepository.deleteEntry({ ownerId: user.id, entryId, deletedAt: new Date() });
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
