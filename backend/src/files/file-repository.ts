import type { File } from './file.js';

export interface FileRepository {
  findByEntryId(entryId: number): Promise<File | null>;
  markAvailable(entryId: number): Promise<File | null>;
}
