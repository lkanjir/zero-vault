import type {
  CompletedUploadFile,
  CompletedVerifiedUploadResult,
  CompleteVerifiedUploadCommand,
  SaveUploadIntentCommand,
  UploadIntentRepository,
} from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import { db } from '../db/db-client.js';
import { entries, files, uploadIntents } from '../db/schema.js';
import { and, eq, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema.js';
import { resolveParentIdInTransaction } from '../entry/resolve-parent-id-in-transaction.js';

export class PostgresIntentRepository implements UploadIntentRepository {
  async findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null> {
    const [row] = await db
      .select()
      .from(uploadIntents)
      .where(and(eq(uploadIntents.uploadId, uploadId), eq(uploadIntents.createdByUserId, userId)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async save(command: SaveUploadIntentCommand): Promise<void> {
    await db.transaction(async (tx) => {
      const targetParentDbId = await resolveParentIdInTransaction(
        tx,
        command.createdByUserId,
        command.parentFolderId,
      );

      await tx.insert(uploadIntents).values({
        ...this.toInsert(command),
        targetParentId: targetParentDbId,
      });
    });
  }

  async markExpiredIfPending(
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
  ): Promise<CompletedVerifiedUploadResult> {
    return db.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(uploadIntents)
        .where(
          and(
            eq(uploadIntents.uploadId, command.uploadId),
            eq(uploadIntents.createdByUserId, command.userId),
          ),
        )
        .for('update')
        .limit(1);

      if (!intent) {
        return { kind: 'not_found' };
      }

      if (intent.status === 'completed') {
        const existingFile = await this.findCompletedFileInTransaction(tx, intent.id);
        return { kind: 'completed', file: existingFile };
      }

      if (intent.status !== 'pending') {
        return { kind: 'not_pending' };
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

      const [file] = await tx
        .insert(files)
        .values({
          entryId: entry.id,
          objectKey: intent.objectKey,
          contentType: intent.contentType,
          sizeBytes: intent.expectedSizeBytes,
          sha256: intent.expectedSha256,
          status: 'quarantined',
        })
        .returning();

      if (!file) {
        throw new Error('Failed to create file');
      }

      await tx
        .update(uploadIntents)
        .set({ status: 'completed', fileId: entry.id, completedAt: command.completedAt })
        .where(eq(uploadIntents.id, intent.id));

      const completedFile: CompletedUploadFile = {
        entryId: entry.id,
        publicId: entry.publicId,
        name: entry.name,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        status: file.status,
      };

      return { kind: 'completed', file: completedFile };
    });
  }

  private async findCompletedFileInTransaction(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    intentId: number,
  ): Promise<CompletedUploadFile> {
    const [row] = await tx
      .select({
        entryId: entries.id,
        publicId: entries.publicId,
        name: entries.name,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
        status: files.status,
      })
      .from(uploadIntents)
      .innerJoin(entries, eq(uploadIntents.fileId, entries.id))
      .innerJoin(files, eq(entries.id, files.entryId))
      .where(and(eq(uploadIntents.id, intentId), eq(uploadIntents.status, 'completed')))
      .limit(1);

    if (!row) {
      throw new Error('Completed upload intent has no file');
    }

    return row;
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
