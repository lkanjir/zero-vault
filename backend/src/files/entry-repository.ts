import type { EntryListCursor } from './entry-list-cursor.js';

export type ListedEntry =
  | {
      kind: 'folder';
      id: string;
      name: string;
      updatedAt: Date;
    }
  | {
      kind: 'file';
      id: string;
      name: string;
      contentType: string;
      sizeBytes: number;
      updatedAt: Date;
    };

export type EntryCursorPosition = Pick<EntryListCursor, 'kindRank' | 'sortName' | 'entryId'>;

export type EntryListRecord = {
  entry: ListedEntry;
  cursor: EntryCursorPosition;
};

export type EntriesQuery = {
  ownerId: number;
  parentId: string | undefined;
  cursor: EntryListCursor | null;
  limit: number;
};

export interface EntryRepository {
  getEntries(query: EntriesQuery): Promise<EntryListRecord[]>;
}
