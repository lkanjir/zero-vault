import type { TransactionContext } from '../db/unit-of-work.js';
import type { DownloadableFile } from './file.js';

export interface FileRepository {
  findAvailableFileByEntryId(
    entryId: number,
    tx?: TransactionContext,
  ): Promise<DownloadableFile | null>;
}
