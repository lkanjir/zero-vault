import type { TransactionContext } from '../db/unit-of-work.js';
import type { DownloadableFile, File } from './file.js';

export interface FileRepository {
  findByEntryId(entryId: number, tx?: TransactionContext): Promise<File | null>;

  findAvailableFileByEntryId(
    entryId: number,
    tx?: TransactionContext,
  ): Promise<DownloadableFile | null>;
}
