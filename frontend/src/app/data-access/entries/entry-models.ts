import { CursorPage } from '../../shared/cursor';

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

export type FolderPathItem = {
  id: string;
  name: string;
};

export type EntryList = CursorPage<EntryResponse> & {
  path: FolderPathItem[];
};

export type EntryUpdateRequest = { name: string } | { parentId: string | null };
