import { CursorPage } from '../../shared/cursor';

export type AccessLevel = 'owner' | 'viewer' | 'editor';

export type EntryAccess = {
  accessLevel: AccessLevel;
  capabilities: {
    download: boolean;
    rename: boolean;
    replaceContent: boolean;
    move: boolean;
    delete: boolean;
    manageSharing: boolean;
  };
};

export type FileEntry = {
  kind: 'file';
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: string;
};

export type FolderEntry = {
  kind: 'folder';
  id: string;
  name: string;
  updatedAt: string;
};

export type EntryResponse = FolderEntry | FileEntry;

export type EntryListItem = EntryResponse & {
  access: EntryAccess;
};

export type FolderPathItem = {
  id: string;
  name: string;
};

export type EntryList = CursorPage<EntryListItem> & {
  path: FolderPathItem[];
};

export type EntryUpdateRequest = { name: string } | { parentId: string | null };

export type EntryKindFilter = 'file' | 'folder' | null;

export type EntryListSort = 'name-asc' | 'name-desc' | 'updated-desc' | 'updated-asc';

export type EntryRequestParams = {
  parentId: string | null;
  cursor: string | null;
  limit: number;
  search: string | null;
  kind: EntryKindFilter;
  sort: EntryListSort;
};
