import type { DownloadableFile, File } from './file.js';

export interface FileRepository {
  findByEntryId(entryId: number): Promise<File | null>;

  findAvailableFileByEntryId(entryId: number): Promise<DownloadableFile | null>;
}
