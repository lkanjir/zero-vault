import { CursorPage } from '../../../shared/cursor';
import { Folder } from './folder';
import { FileEntry } from './file';

export type EntryList = CursorPage<Folder | FileEntry> & {
  parentId: string | null;
};
