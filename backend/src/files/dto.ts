import type { CursorPage } from '../shared/types/cursor-page.js';

export type DownloadResponse = {
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  expiresInSeconds: number;
};

export type FolderResponse = {
  kind: 'folder';
  id: string;
  name: string;
  updatedAt: string;
};

export type FileResponse = {
  kind: 'file';
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: string;
};

export type EntryItem = FolderResponse | FileResponse;

export type EntryListResponse = CursorPage<EntryItem> & {
  parentId: string | null;
};
