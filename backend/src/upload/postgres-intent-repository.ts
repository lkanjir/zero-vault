import type { UploadIntentRepository } from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import { db } from '../db/db-client.js';
import { uploadIntents } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export class PostgresIntentRepository implements UploadIntentRepository {
  async findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null> {
    const [row] = await db
      .select()
      .from(uploadIntents)
      .where(and(eq(uploadIntents.uploadId, uploadId), eq(uploadIntents.createdByUserId, userId)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async save(intent: UploadIntent): Promise<void> {
    await db.insert(uploadIntents).values(this.toInsert(intent));
  }

  async update(intent: UploadIntent): Promise<boolean> {
    const rows = await db
      .update(uploadIntents)
      .set(this.toUpdate(intent))
      .where(
        and(
          eq(uploadIntents.uploadId, intent.uploadId),
          eq(uploadIntents.status, 'pending'),
          eq(uploadIntents.createdByUserId, intent.createdByUserId),
        ),
      )
      .returning({ uploadId: uploadIntents.uploadId });

    return rows.length > 0;
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
      createdByUserId: row.createdByUserId,
      uploadId: row.uploadId,
      objectKey: row.objectKey,
      fileName: row.fileName,
      contentType: row.contentType,
      size: row.sizeBytes,
      status: row.status,
      expectedSha256: row.expectedSha256,
      actualSha256: row.actualSha256,
      checksumVerifiedAt: row.checksumVerifiedAt ? new Date(row.checksumVerifiedAt) : null,
      createdAt: new Date(row.createdAt),
      expiredAt: new Date(row.expiresAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
    };
  }

  private toInsert(intent: UploadIntent): typeof uploadIntents.$inferInsert {
    return {
      createdByUserId: intent.createdByUserId,
      uploadId: intent.uploadId,
      objectKey: intent.objectKey,
      fileName: intent.fileName,
      contentType: intent.contentType,
      sizeBytes: intent.size,
      expectedSha256: intent.expectedSha256,
      status: intent.status,
      expiresAt: intent.expiredAt,
    };
  }

  private toUpdate(intent: UploadIntent): Partial<typeof uploadIntents.$inferInsert> {
    return {
      status: intent.status,
      actualSha256: intent.actualSha256 ?? null,
      checksumVerifiedAt: intent.checksumVerifiedAt ?? null,
      completedAt: intent.completedAt ?? null,
    };
  }
}
