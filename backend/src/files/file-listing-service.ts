import type { User } from '../user/user.js';
import type { EntryItem, EntryListResponse } from './dto.js';
import { decodeCursor, encodeCursor } from './entry-list-cursor.js';
import type { EntryRepository, ListedEntry } from './entry-repository.js';
import type { EntriesListRequest } from './validation-schemas.js';
import { BadRequestError } from '../shared/errors/bad-request-error.js';

export class FileListingService {
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

  private toResponseItem(entry: ListedEntry): EntryItem {
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
