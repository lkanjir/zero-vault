import { CursorPage } from '../../../shared/cursor';
import { FolderEntry } from './folder';
import { FileEntry } from './file';

export type FolderContext = {
  id: string;
  name: string;
  parentId: string | null;
};

export type EntryList = CursorPage<FolderEntry | FileEntry> & {
  currentFolder: FolderContext | null;
};
