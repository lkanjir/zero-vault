import { CursorPage } from '../../../shared/cursor';
import { FolderEntry } from './folder';
import { FileEntry } from './file';

export type EntryList = CursorPage<FolderEntry | FileEntry> & {
  parentId: string | null;
};
