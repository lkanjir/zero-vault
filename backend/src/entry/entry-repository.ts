import type { TransactionContext } from '../db/unit-of-work.js';
import type { EntryListCursor } from './entry-list-cursor.js';
import type { Folder } from '../folder/folder.js';
import type { FolderPath } from './folder-path.js';
import type { Entry, EntryKind, EntryListSort } from './entry.js';

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
  ownerId: number;
  parentId: number | null;
  name: string;
};

export type FindOrCreateFolderCommand = {
  ownerId: number;
  parentId: number | null;
  name: string;
  relativePath: string;
};

export type FindOrCreateFolderResult = {
  folder: Folder;
  created: boolean;
};

export type UpdateEntryCommand = {
  entryId: number;
  ownerId: number;
  parentId?: number | null;
  name?: string;
  updatedAt: Date;
};

export type UpdatedEntryRecord = {
  entry: Entry;
  listedEntry: ListedEntry;
};

export type DeleteEntryCommand = {
  entry: Entry;
  deletedAt: Date;
};

export type EntryParentContext = {
  publicId: string;
  name: string;
};

export interface EntryRepository {
  getEntries(query: EntriesQuery): Promise<EntryListing>;
  createFolder(command: CreateFolderCommand, tx: TransactionContext): Promise<Folder>;
  findOrCreateFolder(
    command: FindOrCreateFolderCommand,
    tx: TransactionContext,
  ): Promise<FindOrCreateFolderResult>;
  getFolderDepth(
    ownerId: number,
    folderId: number,
    maxDepth: number,
    tx: TransactionContext,
  ): Promise<number>;
  assertFolderCanMove(
    folderId: number,
    nextParentId: number | null,
    tx: TransactionContext,
  ): Promise<void>;
  updateEntry(command: UpdateEntryCommand, tx: TransactionContext): Promise<UpdatedEntryRecord>;
  resolveParentContext(
    ownerId: number,
    parentId: number,
    tx: TransactionContext,
  ): Promise<EntryParentContext>;
  deleteEntry(command: DeleteEntryCommand, tx: TransactionContext): Promise<void>;
}
