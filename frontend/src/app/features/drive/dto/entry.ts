import { CursorPage } from '../../../shared/cursor';
import { FolderEntry } from './folder';
import { FileEntry } from './file';

export type FolderPathItem = {
  id: string;
  name: string;
};

export type EntryList = CursorPage<FolderEntry | FileEntry> & {
  path: FolderPathItem[];
};
