import type { EntryListCursor } from './entry-list-cursor.js';
import type { Folder } from '../folder/folder.js';
import type { FolderPathItem } from './dto.js';

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

export type EntryListing = {
  entries: EntryListRecord[];
  path: FolderPathItem[];
};

export type ResolvedFolderPath = {
  dbId: number;
  path: FolderPathItem[];
};

export type EntriesQuery = {
  ownerId: number;
  parentId: string | null;
  cursor: EntryListCursor | null;
  limit: number;
};

export type CreateFolderCommand = {
  ownerId: number;
  parentId: string | null;
  name: string;
};

export type UpdateEntryCommand = {
  ownerId: number;
  entryId: string;
  parentId?: string | null;
  name?: string;
};

export type DeleteEntryCommand = {
  ownerId: number;
  entryId: string;
  deletedAt: Date;
};

export interface EntryRepository {
  getEntries(query: EntriesQuery): Promise<EntryListing>;
  createFolder(command: CreateFolderCommand): Promise<Folder>;
  updateEntry(command: UpdateEntryCommand): Promise<ListedEntry>;
  deleteEntry(command: DeleteEntryCommand): Promise<void>;
}
