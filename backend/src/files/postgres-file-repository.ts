import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from '../db/db-client.js';
import type { TransactionContext } from '../db/unit-of-work.js';
import { entries, files } from '../db/schema.js';
import type { FileRepository } from './file-repository.js';
import type { DownloadableFile } from './file.js';

export class PostgresFileRepository implements FileRepository {
  constructor(private readonly db: Database) {}

  async findAvailableFileByEntryId(
    entryId: number,
    tx?: TransactionContext,
  ): Promise<DownloadableFile | null> {
    const [row] = await (tx ?? this.db)
      .select({
        entryId: entries.id,
        publicId: entries.publicId,
        ownerId: entries.ownerId,
        name: entries.name,
        objectKey: files.objectKey,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
      })
      .from(entries)
      .innerJoin(files, eq(entries.id, files.entryId))
      .where(and(eq(entries.id, entryId), eq(entries.kind, 'file'), isNull(entries.deletedAt)))
      .limit(1);

    return row ?? null;
  }
}
