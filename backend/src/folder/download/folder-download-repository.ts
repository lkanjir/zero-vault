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

export interface FolderDownloadRepository {
  create(command: CreateFolderDownloadCommand): Promise<FolderDownload>;
  findByOwnerAndDownloadId(ownerId: number, downloadId: string): Promise<FolderDownload | null>;
  claimNext(command: ClaimNextFolderDownloadCommand): Promise<FolderDownload | null>;
}
