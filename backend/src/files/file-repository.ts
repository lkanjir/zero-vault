import type { DownloadableFile, File } from './file.js';

export interface FileRepository {
  findByEntryId(entryId: number): Promise<File | null>;
  markAvailable(entryId: number): Promise<File | null>;

  findAvailableFileByPublicIdForOwner(
    fileId: string,
    ownerId: number,
  ): Promise<DownloadableFile | null>;
}
