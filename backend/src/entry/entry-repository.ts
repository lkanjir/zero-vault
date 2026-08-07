import type { EntryListCursor } from './entry-list-cursor.js';
import type { Folder } from '../folder/folder.js';
import type { FolderPath } from './folder-path.js';
import type { EntryKind, EntryListSort } from './entry.js';

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

export type EntryCursorPosition = Pick<
  EntryListCursor,
  'kindRank' | 'sortName' | 'entryId' | 'updatedAt'
>;

export type EntryListRecord = {
  entry: ListedEntry;
  cursor: EntryCursorPosition;
};

export type EntryListing = {
  entries: EntryListRecord[];
  path: FolderPath;
};

export type ResolvedFolderPath = {
  dbId: number;
  path: FolderPath;
};

export type EntriesQuery = {
  ownerId: number;
  parentId: string | null;
  search: string | null;
  kind: EntryKind | null;
  sort: EntryListSort;
  cursor: EntryListCursor | null;
  limit: number;
};

export type CreateFolderCommand = {
  actorUserId: number;
  parentId: string | null;
  name: string;
};

export type UpdateEntryCommand = {
  actorUserId: number;
  entryId: string;
  parentId?: string | null;
  name?: string;
};

export type DeleteEntryCommand = {
  actorUserId: number;
  entryId: string;
};

export interface EntryRepository {
  getEntries(query: EntriesQuery): Promise<EntryListing>;
  createFolder(command: CreateFolderCommand): Promise<Folder>;
  updateEntry(command: UpdateEntryCommand): Promise<ListedEntry>;
  deleteEntry(command: DeleteEntryCommand): Promise<void>;
}
