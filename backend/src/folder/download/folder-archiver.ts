import type { FolderArchiveEntry } from './folder-download.js';

export type CreateFolderArchiveCommand = {
  entries: readonly FolderArchiveEntry[];
  archiveObjectKey: string;
  signal?: AbortSignal;
};

export type CreateFolderArchiveResult = {
  sizeBytes: number;
};

export interface FolderArchiver {
  create(command: CreateFolderArchiveCommand): Promise<CreateFolderArchiveResult>;
}
