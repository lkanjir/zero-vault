import type { FolderDownload } from './folder-download.js';

export type CreateFolderDownloadCommand = {
  downloadId: string;
  ownerId: number;
  folderPublicId: string;
  archiveObjectKey: string;
  createdAt: Date;
};

export interface FolderDownloadRepository {
  create(command: CreateFolderDownloadCommand): Promise<FolderDownload>;
}
