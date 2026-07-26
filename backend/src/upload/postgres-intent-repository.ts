import type {
  AssertUploadTargetAvailableCommand,
  CompletedUploadFile,
  CompletedVerifiedUploadResult,
  CompleteVerifiedUploadCommand,
  ExpirePendingIntentsCommand,
  SaveUploadIntentCommand,
  UploadIntentRepository,
} from './upload-intent-repository.js';
import type { UploadIntent } from './upload-intent.js';
import { db, type Transaction } from '../db/db-client.js';
import { entries, files, uploadIntents } from '../db/schema.js';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { resolveParentIdInTransaction } from '../entry/resolve-parent-id-in-transaction.js';
import { mapEntryDatabaseError } from '../entry/map-entry-db-error.js';
import { AppError } from '../shared/errors/api/app-error.js';
import { enqueueObjectDeletionsInTransaction } from '../object-deletion/object-deletion-helpers.js';

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
    try {
      return await db.transaction(async (tx) => {
        const intent = await this.findIntentForCompletion(tx, command);

        if (!intent) {
          return { kind: 'not_found' };
        }

        return this.completeLockedIntent(tx, intent, command);
      });
    } catch (error) {
      throw mapEntryDatabaseError(error);
    }
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
        updatedAt: entries.updatedAt,
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
      await this.expireLockedIntents(tx, [intent.id]);
      return { kind: 'expired' };
    }

    const entry = await this.createEntryForIntent(tx, command.userId, intent);

    if (!entry) {
      throw new Error('Greška kod kreiranja zapisa');
    }

    const file = await this.createFileForIntent(tx, entry.id, intent);

    if (!file) {
      throw new Error('Greška kod kreiranja datoteke');
    }

    await this.markIntentCompleted(tx, intent.id, file.entryId, command.completedAt);

    const completedFile: CompletedUploadFile = {
      entryId: file.entryId,
      publicId: entry.publicId,
      name: entry.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      updatedAt: entry.updatedAt,
    };

    return { kind: 'completed', file: completedFile };
  }

  private isPastFinalizeDeadline(intent: UploadIntentRow, completedAt: Date): boolean {
    return intent.finalizeDeadline.getTime() < completedAt.getTime();
  }

  private async expireLockedIntents(
    tx: Transaction,
    intentIds: readonly number[],
  ): Promise<number> {
    if (intentIds.length === 0) {
      return 0;
    }

    const expired = await tx
      .update(uploadIntents)
      .set({ status: 'expired' })
      .where(and(inArray(uploadIntents.id, intentIds), eq(uploadIntents.status, 'pending')))
      .returning({ objectKey: uploadIntents.objectKey });

    if (expired.length !== intentIds.length) {
      throw new Error('Failed to expire all locked upload intents');
    }

    await enqueueObjectDeletionsInTransaction(
      tx,
      expired.map((intent) => ({ objectKey: intent.objectKey, reason: 'expired_upload' })),
    );

    return expired.length;
  }

  private async createFileForIntent(
    tx: Transaction,
    entryId: number,
    intent: UploadIntentRow,
  ): Promise<FileRow | null> {
    const [file] = await tx
      .insert(files)
      .values({
        entryId: entryId,
        objectKey: intent.objectKey,
        contentType: intent.contentType,
        sizeBytes: intent.expectedSizeBytes,
        sha256: intent.expectedSha256,
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

  async expirePendingIntents(command: ExpirePendingIntentsCommand): Promise<number> {
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: uploadIntents.id })
        .from(uploadIntents)
        .where(
          and(
            eq(uploadIntents.status, 'pending'),
            lt(uploadIntents.finalizeDeadline, command.expiredAt),
          ),
        )
        .orderBy(uploadIntents.finalizeDeadline, uploadIntents.id)
        .for('update', { skipLocked: true })
        .limit(command.limit);

      return this.expireLockedIntents(
        tx,
        candidates.map((candidate) => candidate.id),
      );
    });
  }

  async assertUploadTargetAvailable(command: AssertUploadTargetAvailableCommand): Promise<void> {
    await db.transaction(async (tx) => {
      const targetParentDbId = await resolveParentIdInTransaction(
        tx,
        command.userId,
        command.parentFolderId,
      );

      const parentCondition =
        targetParentDbId === null
          ? isNull(entries.parentId)
          : eq(entries.parentId, targetParentDbId);

      const [existingEntry] = await tx
        .select({ id: entries.id })
        .from(entries)
        .where(
          and(
            eq(entries.ownerId, command.userId),
            parentCondition,
            isNull(entries.deletedAt),
            sql`lower(${entries.name}) = lower(${command.fileName})`,
          ),
        )
        .limit(1);

      if (existingEntry) {
        throw new AppError('duplicate_entry_name');
      }
    });
  }
}
