export type FolderDownloadStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

export type FolderDownload = {
  id: number;
  downloadId: string;
  ownerId: number;
  folderId: number;
  folderName: string;
  archiveObjectKey: string;
  status: FolderDownloadStatus;
  attemptCount: number;
  archiveSizeBytes: number | null;
  failureCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  leaseExpiresAt: Date | null;
  expiresAt: Date | null;
};
