import type {
  CompletedUploadFile,
  CompletedVerifiedUploadResult,
  CompleteVerifiedUploadCommand,
  ExpiredIntent,
  SaveUploadIntentCommand,
  UploadIntentRepository,
} from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import { db } from '../db/db-client.js';
import { entries, files, uploadIntents } from '../db/schema.js';
import { and, eq, sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema.js';
import { resolveParentIdInTransaction } from '../entry/resolve-parent-id-in-transaction.js';

type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

type UploadIntentRow = typeof uploadIntents.$inferSelect;
type EntryRow = typeof entries.$inferSelect;
type FileRow = typeof files.$inferSelect;

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

  async completeVerifiedUpload(
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult> {
    return db.transaction(async (tx) => {
      const intent = await this.findIntentForCompletion(tx, command);

      if (!intent) {
        return { kind: 'not_found' };
      }

      return this.completeLockedIntent(tx, intent, command);
    });
  }

  private async findIntentForCompletion(
    tx: Transaction,
    command: CompleteVerifiedUploadCommand,
  ): Promise<UploadIntentRow | null> {
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

    return intent ?? null;
  }

  private async completeLockedIntent(
    tx: Transaction,
    intent: UploadIntentRow,
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult> {
    switch (intent.status) {
      case 'completed':
        return {
          kind: 'completed',
          file: await this.findCompletedFileInTransaction(tx, intent.id),
        };
      case 'expired':
        return { kind: 'expired' };
      case 'rejected':
        return { kind: 'not_pending', status: intent.status };
      case 'pending':
        return this.completePendingIntent(tx, intent, command);
    }
  }

  private async findCompletedFileInTransaction(
    tx: Transaction,
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

  private async completePendingIntent(
    tx: Transaction,
    intent: UploadIntentRow,
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult> {
    if (this.isPastFinalizeDeadline(intent, command.completedAt)) {
      await this.expireIntent(tx, intent.id);
      return { kind: 'expired' };
    }

    const entry = await this.createEntryForIntent(tx, command.userId, intent);

    if (!entry) {
      throw new Error('Failed to create entry');
    }

    const file = await this.createFileForIntent(tx, entry.id, intent, command.completedAt);

    if (!file) {
      throw new Error('Failed to create file');
    }

    await this.markIntentCompleted(tx, intent.id, file.entryId, command.completedAt);

    const completedFile: CompletedUploadFile = {
      entryId: file.entryId,
      publicId: entry.publicId,
      name: entry.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      status: file.status,
    };

    return { kind: 'completed', file: completedFile };
  }

  private isPastFinalizeDeadline(intent: UploadIntentRow, completedAt: Date): boolean {
    return intent.finalizeDeadline.getTime() < completedAt.getTime();
  }

  private async expireIntent(tx: Transaction, intentId: number): Promise<void> {
    await tx.update(uploadIntents).set({ status: 'expired' }).where(eq(uploadIntents.id, intentId));
  }

  private async createFileForIntent(
    tx: Transaction,
    entryId: number,
    intent: UploadIntentRow,
    completedAt: Date,
  ): Promise<FileRow | null> {
    const [file] = await tx
      .insert(files)
      .values({
        entryId: entryId,
        objectKey: intent.objectKey,
        contentType: intent.contentType,
        sizeBytes: intent.expectedSizeBytes,
        sha256: intent.expectedSha256,
        status: 'available',
        availableAt: completedAt,
        statusChangedAt: completedAt,
      })
      .returning();

    return file ?? null;
  }

  private async createEntryForIntent(
    tx: Transaction,
    userId: number,
    intent: UploadIntentRow,
  ): Promise<EntryRow | null> {
    const [entry] = await tx
      .insert(entries)
      .values({
        ownerId: userId,
        parentId: intent.targetParentId,
        kind: 'file',
        name: intent.fileName,
      })
      .returning();

    return entry ?? null;
  }

  private async markIntentCompleted(
    tx: Transaction,
    intentId: number,
    entryId: number,
    completedAt: Date,
  ): Promise<void> {
    await tx
      .update(uploadIntents)
      .set({ status: 'completed', fileId: entryId, completedAt: completedAt })
      .where(eq(uploadIntents.id, intentId));
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

  async markExpiredIntents(now: Date, limit: number): Promise<ExpiredIntent[]> {
    const updateStatement = sql`
      WITH expired_rows AS (
        SELECT id
        FROM upload_intents
        WHERE finalize_deadline < ${now} AND status = 'pending'
        ORDER BY finalize_deadline, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) 
      UPDATE upload_intents AS ui 
        SET status = 'expired'
        FROM expired_rows AS er
        WHERE ui.id = er.id
        RETURNING ui.id, ui.object_key AS objectKey
    `;

    const result = await db.execute<ExpiredIntent>(updateStatement);

    return result.rows;
  }
}
