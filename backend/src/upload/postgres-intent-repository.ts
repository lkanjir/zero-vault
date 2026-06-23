import type { UploadIntentRepository } from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import { db } from '../db/db-client.js';
import { uploadIntents } from '../db/generated/schema.js';
import { eq } from 'drizzle-orm';

export class PostgresIntentRepository implements UploadIntentRepository {
  async findById(uploadId: string): Promise<UploadIntent | null> {
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
    await db.update(uploadIntents).set(this.toUpdate(intent))
  }

  async deleteById(uploadId: string): Promise<boolean> {
    const rows = await db.delete(uploadIntents).where(eq(uploadIntents.uploadId, uploadId )).returning();
    if(rows){
      return true;
    }

    else return false;
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
      status: intent.status,
      expiresAt: intent.expiredAt.toISOString(),
    };
  }

  private toUpdate(intent: UploadIntent): Partial<typeof uploadIntents.$inferInsert>{
    return {
      status: intent.status,
      completedAt: intent.completedAt?.toISOString()
    }
  }
}
