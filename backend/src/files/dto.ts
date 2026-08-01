import type { CursorPage } from '../shared/types/cursor-page.js';
import type { FileGrantPermission } from '../sharing/file-grant.js';

export type FileDownloadResponse = {
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  expiresInSeconds: number;
};

export type FileResponse = {
  kind: 'file';
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: string;
};

export type ShareFileAcceptedResponse = {
  status: 'accepted';
};

export type FileShareResponse = {
  shareId: string;
  recipientEmail: string;
  permission: FileGrantPermission;
  expiresAt: string | null;
};

export type FileShareListResponse = CursorPage<FileShareResponse>;
