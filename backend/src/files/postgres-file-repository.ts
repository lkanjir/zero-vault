import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/db-client.js';
import { entries, files } from '../db/schema.js';
import type { FileRepository } from './file-repository.js';
import type { DownloadableFile, File } from './file.js';

export class PostgresFileRepository implements FileRepository {
  async findByEntryId(entryId: number): Promise<File | null> {
    const [row] = await db.select().from(files).where(eq(files.entryId, entryId)).limit(1);

    return row ?? null;
  }

  async findAvailableFileByPublicIdForOwner(
    fileId: string,
    ownerId: number,
  ): Promise<DownloadableFile | null> {
    const [row] = await db
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
      .where(
        and(
          eq(entries.publicId, fileId),
          eq(entries.ownerId, ownerId),
          eq(files.status, 'available'),
          eq(entries.kind, 'file'),
          isNull(entries.deletedAt),
        ),
      )
      .limit(1);

    return row ?? null;
  }
}
