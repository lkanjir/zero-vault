import type { FolderDownload } from './folder-download.js';

export type CreateFolderDownloadCommand = {
  downloadId: string;
  ownerId: number;
  folderPublicId: string;
  archiveObjectKey: string;
  createdAt: Date;
};

export type ClaimNextFolderDownloadCommand = {
  claimedAt: Date;
  leaseExpiresAt: Date;
};

export type RenewFolderDownloadLeaseCommand = {
  id: number;
  attemptCount: number;
  leaseExpiresAt: Date;
};

export type MarkFolderDownloadReadyCommand = {
  id: number;
  attemptCount: number;
  archiveObjectKey: string;
  archiveSizeBytes: number;
  finishedAt: Date;
  expiresAt: Date;
};

export type MarkFolderDownloadFailedCommand = {
  id: number;
  attemptCount: number;
  failureCode: string;
  finishedAt: Date;
};

export interface FolderDownloadRepository {
  create(command: CreateFolderDownloadCommand): Promise<FolderDownload>;
  findByOwnerAndDownloadId(ownerId: number, downloadId: string): Promise<FolderDownload | null>;
  claimNext(command: ClaimNextFolderDownloadCommand): Promise<FolderDownload | null>;
  renewLease(command: RenewFolderDownloadLeaseCommand): Promise<boolean>;
  markReady(command: MarkFolderDownloadReadyCommand): Promise<boolean>;
  markFailed(command: MarkFolderDownloadFailedCommand): Promise<boolean>;
}
