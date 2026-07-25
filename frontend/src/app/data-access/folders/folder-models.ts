export type CreateFolderRequest = {
  name: string;
  parentId: string | null;
};

export type CreateFolderDownloadResponse = {
  downloadId: string;
  fileName: string;
  status: 'queued';
};

type FolderDownloadStatusBase = {
  downloadId: string;
  fileName: string;
};

export type FolderDownloadStatusResponse =
  | (FolderDownloadStatusBase & {
      status: 'queued' | 'processing';
    })
  | (FolderDownloadStatusBase & {
      status: 'ready';
      sizeBytes: number;
      expiresAt: string;
      downloadUrl: string;
      expiresInSeconds: number;
    })
  | (FolderDownloadStatusBase & {
      status: 'failed' | 'expired';
    });
