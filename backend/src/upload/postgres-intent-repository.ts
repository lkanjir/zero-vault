import type { UploadIntentRepository } from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import { db } from '../db/db-client.js';
import { uploadIntents } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export class PostgresIntentRepository implements UploadIntentRepository {
  async findByUploadId(uploadId: string): Promise<UploadIntent | null> {
    const rows = await db
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.uploadId, uploadId))
      .limit(1);

    const row = rows[0];

    return row ? this.toDomain(row) : null;
  }

  async save(intent: UploadIntent): Promise<void> {
    await db.insert(uploadIntents).values(this.toInsert(intent));
  }

  async update(intent: UploadIntent): Promise<void> {
    await db
      .update(uploadIntents)
      .set(this.toUpdate(intent))
      .where(and(eq(uploadIntents.uploadId, intent.uploadId), eq(uploadIntents.status, 'pending')));
  }

  async deleteByUploadId(uploadId: string): Promise<boolean> {
    const rows = await db
      .delete(uploadIntents)
      .where(eq(uploadIntents.uploadId, uploadId))
      .returning();

    return rows.length > 0;
  }

  private toDomain(row: typeof uploadIntents.$inferSelect): UploadIntent {
    return {
      uploadId: row.uploadId,
      objectKey: row.objectKey,
      fileName: row.fileName,
      contentType: row.contentType,
      size: row.sizeBytes,
      status: row.status,
      createdAt: new Date(row.createdAt),
      expiredAt: new Date(row.expiresAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
    };
  }

  private toInsert(intent: UploadIntent): typeof uploadIntents.$inferInsert {
    return {
      uploadId: intent.uploadId,
      objectKey: intent.objectKey,
      fileName: intent.fileName,
      contentType: intent.contentType,
      sizeBytes: intent.size,
      expectedSha256: intent.sha256,
      status: intent.status,
      expiresAt: intent.expiredAt,
    };
  }

  private toUpdate(intent: UploadIntent): Partial<typeof uploadIntents.$inferInsert> {
    return {
      status: intent.status,
      completedAt: intent.completedAt,
    };
  }
}
