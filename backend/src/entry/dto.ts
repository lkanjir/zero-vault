import type { EntryAccessResponse } from '../authorization/dto.js';
import type { FileResponse } from '../files/dto.js';
import type { FolderResponse } from '../folder/dto.js';
import type { CursorPage } from '../shared/types/cursor-page.js';

export type EntryResponse = FolderResponse | FileResponse;

export type EntryListItemResponse = EntryResponse & {
  access: EntryAccessResponse;
};

export type FolderPathItem = {
  id: string;
  name: string;
};

export type EntryListResponse = CursorPage<EntryListItemResponse> & {
  path: FolderPathItem[];
};
