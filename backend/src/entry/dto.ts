import type { FileResponse } from '../files/dto.js';
import type { FolderResponse } from '../folder/dto.js';
import type { CursorPage } from '../shared/types/cursor-page.js';

export type EntryItem = FolderResponse | FileResponse;

export type EntryListResponse = CursorPage<EntryItem> & {
  parentId: string | null;
};
