import { CursorPage } from '../../../shared/cursor';
import { FolderEntry } from './folder';
import { FileEntry } from './file';

export type EntryResponse = FolderEntry | FileEntry;

export type FolderPathItem = {
  id: string;
  name: string;
};

export type EntryList = CursorPage<EntryResponse> & {
  path: FolderPathItem[];
};

export type EntryUpdateRequest = { name: string } | { parentId: string | null };
