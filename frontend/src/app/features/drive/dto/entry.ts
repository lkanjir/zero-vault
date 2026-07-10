import { CursorPage } from '../../../shared/cursor';
import { Folder } from './folder';
import { File } from './file';

export type EntryList = CursorPage<Folder | File> & {
  parentId: string | null;
};
