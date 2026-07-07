import { eq, and } from 'drizzle-orm';
import { db } from '../db/db-client.js';
import { files } from '../db/schema.js';
import type { FileRepository } from './file-repository.js';
import type { File } from './file.js';

export class PostgresFileRepository implements FileRepository {
  async findQuarantinedByEntryId(entryId: number): Promise<File | null> {
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.entryId, entryId), eq(files.status, 'quarantined')))
      .limit(1);

    return row ?? null;
  }

  async markAvailable(entryId: number): Promise<File | null> {
    const updatedDate = new Date();

    const [available] = await db
      .update(files)
      .set({ status: 'available', availableAt: updatedDate, statusChangedAt: updatedDate })
      .where(and(eq(files.entryId, entryId), eq(files.status, 'quarantined')))
      .returning();

    return available ?? null;
  }
}
