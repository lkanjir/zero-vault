export type CreateFolderRequest = {
  name: string;
  parentId: string | null;
};

export type EnsureFolderTreeRequest = {
  parentId: string | null;
  paths: readonly string[];
};

export type EnsureFolderTreeResponse = {
  folders: Record<string, string>;
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
