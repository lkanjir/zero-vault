export type CreateFolderDownloadResponse = {
  downloadId: string;
  fileName: string;
  status: 'queued';
};

export type FolderDownloadStatusBase = {
  downloadId: string;
  fileName: string;
};

export type FolderDownloadStatusResponse =
  | (FolderDownloadStatusBase & { status: 'queued' | 'processing' })
  | (FolderDownloadStatusBase & { status: 'ready'; sizeBytes: number; expiresAt: string })
  | (FolderDownloadStatusBase & { status: 'failed' | 'expired' });
