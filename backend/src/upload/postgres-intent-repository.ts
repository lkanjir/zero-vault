import type {
  CompletedUploadFile,
  CompleteVerifiedUploadCommand,
  UploadIntentRepository,
} from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import { db } from '../db/db-client.js';
import { entries, files, uploadIntents } from '../db/schema.js';
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

  async save(intent: Omit<UploadIntent, 'id'>): Promise<void> {
    await db.insert(uploadIntents).values(this.toInsert(intent));
  }

  async markedExpiredIfPending(
    createdByUserId: number,
    uploadId: string,
  ): Promise<UploadIntent | null> {
    const [row] = await db
      .update(uploadIntents)
      .set({ status: 'expired' })
      .where(
        and(
          eq(uploadIntents.uploadId, uploadId),
          eq(uploadIntents.createdByUserId, createdByUserId),
          eq(uploadIntents.status, 'pending'),
        ),
      )
      .returning();

    return row ? this.toDomain(row) : null;
  }

  completeVerifiedUpload(
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedUploadFile | null> {
    return db.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(uploadIntents)
        .where(
          and(
            eq(uploadIntents.uploadId, command.uploadId),
            eq(uploadIntents.createdByUserId, command.userId),
            eq(uploadIntents.status, 'pending'),
          ),
        )
        .for('update')
        .limit(1);

      if (!intent) {
        return null;
      }

      const [entry] = await tx
        .insert(entries)
        .values({
          ownerId: command.userId,
          parentId: intent.targetParentId,
          kind: 'file',
          name: intent.fileName,
        })
        .returning();

      if (!entry) {
        throw new Error('Failed to create file entry');
      }

      const createdFileStatus = 'quarantined' as const;

      const [file] = await tx
        .insert(files)
        .values({
          entryId: entry.id,
          objectKey: command.objectKey,
          contentType: command.contentType,
          sizeBytes: command.sizeBytes,
          sha256: command.sha256,
          status: createdFileStatus,
        })
        .returning();

      if (!file) {
        throw new Error('Failed to create file');
      }

      await tx
        .update(uploadIntents)
        .set({ status: 'completed', fileId: entry.id, completedAt: command.completedAt })
        .where(eq(uploadIntents.id, intent.id));

      return {
        entryId: entry.id,
        publicId: entry.publicId,
        name: entry.name,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        status: createdFileStatus,
      };
    });
  }

  private toDomain(row: typeof uploadIntents.$inferSelect): UploadIntent {
    return {
      id: row.id,
      uploadId: row.uploadId,
      fileId: row.fileId,
      createdByUserId: row.createdByUserId,
      targetParentId: row.targetParentId,
      fileName: row.fileName,
      objectKey: row.objectKey,
      contentType: row.contentType,
      expectedSizeBytes: row.expectedSizeBytes,
      expectedSha256: row.expectedSha256,
      status: row.status,
      createdAt: new Date(row.createdAt),
      uploadUrlExpiresAt: row.uploadUrlExpiresAt,
      completedAt: row.completedAt,
      finalizeDeadline: row.finalizeDeadline,
    };
  }

  private toInsert(intent: Omit<UploadIntent, 'id'>): typeof uploadIntents.$inferInsert {
    return {
      uploadId: intent.uploadId,
      createdByUserId: intent.createdByUserId,
      fileName: intent.fileName,
      objectKey: intent.objectKey,
      contentType: intent.contentType,
      expectedSizeBytes: intent.expectedSizeBytes,
      expectedSha256: intent.expectedSha256,
      status: intent.status,
      createdAt: intent.createdAt,
      uploadUrlExpiresAt: intent.uploadUrlExpiresAt,
      finalizeDeadline: intent.finalizeDeadline,
    };
  }
}
