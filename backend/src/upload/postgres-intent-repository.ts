import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/db-client.js';
import { entries, files, uploadIntents } from '../db/schema.js';
import type { TransactionContext } from '../db/unit-of-work.js';
import { mapEntryDatabaseError } from '../entry/map-entry-db-error.js';
import { enqueueObjectDeletionsInTransaction } from '../object-deletion/object-deletion-helpers.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type {
  AssertUploadTargetAvailableCommand,
  CompleteCreateIntentCommand,
  CompletedUploadFile,
  CompleteReplaceIntentCommand,
  CompleteReplaceIntentResult,
  ExpirePendingIntentsCommand,
  SaveReplacementUploadIntentCommand,
  SaveUploadIntentCommand,
  UploadIntentRepository,
} from './upload-intent-repository.js';
import type { UploadIntent, UploadIntentInput } from './upload-intent.js';

type EntryRow = typeof entries.$inferSelect;
type FileRow = typeof files.$inferSelect;

export class PostgresIntentRepository implements UploadIntentRepository {
  constructor(private readonly db: Database) {}

  async findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null> {
    const [row] = await this.db
      .select()
      .from(uploadIntents)
      .where(and(eq(uploadIntents.uploadId, uploadId), eq(uploadIntents.createdByUserId, userId)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async findByUserAndUploadIdForUpdate(
    userId: number,
    uploadId: string,
    tx: TransactionContext,
  ): Promise<UploadIntent | null> {
    const [row] = await tx
      .select()
      .from(uploadIntents)
      .where(and(eq(uploadIntents.uploadId, uploadId), eq(uploadIntents.createdByUserId, userId)))
      .for('update')
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async findCompletedFileByIntentId(
    intentId: number,
    tx: TransactionContext,
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

  async save(command: SaveUploadIntentCommand, tx: TransactionContext): Promise<void> {
    await tx.insert(uploadIntents).values({
      ...this.toPendingInsert(command.upload),
      operation: 'create',
      fileName: command.fileName,
      targetParentId: command.targetParentId,
    });
  }

  async saveReplacement(
    command: SaveReplacementUploadIntentCommand,
    tx: TransactionContext,
  ): Promise<void> {
    const [file] = await tx
      .select({ contentVersion: files.contentVersion })
      .from(files)
      .where(eq(files.entryId, command.targetFileId))
      .limit(1);

    if (!file) {
      throw new Error('Replacement target is missing file metadata');
    }

    await tx.insert(uploadIntents).values({
      ...this.toPendingInsert(command.upload),
      operation: 'replace',
      fileName: null,
      targetFileId: command.targetFileId,
      expectedContentVersion: file.contentVersion,
    });
  }

  async assertUploadTargetAvailable(
    command: AssertUploadTargetAvailableCommand,
    tx: TransactionContext,
  ): Promise<void> {
    const parentCondition =
      command.targetParentId === null
        ? isNull(entries.parentId)
        : eq(entries.parentId, command.targetParentId);

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
  }

  async expireLockedIntent(intentId: number, tx: TransactionContext): Promise<void> {
    await this.expireLockedIntents(tx, [intentId]);
  }

  async completeCreateIntent(
    command: CompleteCreateIntentCommand,
    tx: TransactionContext,
  ): Promise<CompletedUploadFile> {
    try {
      const entry = await this.createEntryForIntent(tx, command.userId, command.intent);

      if (!entry) {
        throw new Error('Failed to create file entry');
      }

      const file = await this.createFileForIntent(tx, entry.id, command.intent);

      if (!file) {
        throw new Error('Failed to create file metadata');
      }

      await this.markIntentCompleted(tx, command.intent.id, file.entryId, command.completedAt);

      return {
        entryId: file.entryId,
        publicId: entry.publicId,
        name: entry.name,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        updatedAt: entry.updatedAt,
      };
    } catch (error) {
      throw mapEntryDatabaseError(error);
    }
  }

  async completeReplaceIntent(
    command: CompleteReplaceIntentCommand,
    tx: TransactionContext,
  ): Promise<CompleteReplaceIntentResult> {
    const { intent, targetEntryId, completedAt } = command;
    const expectedContentVersion = intent.expectedContentVersion;

    if (expectedContentVersion === null) {
      throw new Error('Replace intent is missing expected content version');
    }

    try {
      const [currentFile] = await tx
        .select({ objectKey: files.objectKey, contentVersion: files.contentVersion })
        .from(files)
        .where(eq(files.entryId, targetEntryId))
        .limit(1);

      if (!currentFile) {
        throw new Error('Replacement target is missing file metadata');
      }

      if (currentFile.contentVersion !== expectedContentVersion) {
        await this.markIntentSuperseded(tx, intent.id, intent.objectKey);
        return { kind: 'superseded' };
      }

      const [updatedFile] = await tx
        .update(files)
        .set({
          objectKey: intent.objectKey,
          contentType: intent.contentType,
          sizeBytes: intent.expectedSizeBytes,
          sha256: intent.expectedSha256,
          contentVersion: sql`${files.contentVersion} + 1`,
        })
        .where(
          and(eq(files.entryId, targetEntryId), eq(files.contentVersion, expectedContentVersion)),
        )
        .returning({
          entryId: files.entryId,
          contentType: files.contentType,
          sizeBytes: files.sizeBytes,
          contentVersion: files.contentVersion,
        });

      if (!updatedFile) {
        await this.markIntentSuperseded(tx, intent.id, intent.objectKey);
        return { kind: 'superseded' };
      }

      const [updatedEntry] = await tx
        .update(entries)
        .set({ updatedAt: completedAt })
        .where(eq(entries.id, targetEntryId))
        .returning({
          publicId: entries.publicId,
          name: entries.name,
          updatedAt: entries.updatedAt,
        });

      if (!updatedEntry) {
        throw new Error('Replacement target entry could not be updated');
      }

      await this.markIntentCompleted(tx, intent.id, updatedFile.entryId, completedAt);
      await enqueueObjectDeletionsInTransaction(tx, [
        {
          objectKey: currentFile.objectKey,
          reason: 'replaced_file',
        },
      ]);

      return {
        kind: 'completed',
        previousContentVersion: currentFile.contentVersion,
        newContentVersion: updatedFile.contentVersion,
        file: {
          entryId: updatedFile.entryId,
          publicId: updatedEntry.publicId,
          name: updatedEntry.name,
          contentType: updatedFile.contentType,
          sizeBytes: updatedFile.sizeBytes,
          updatedAt: updatedEntry.updatedAt,
        },
      };
    } catch (error) {
      throw mapEntryDatabaseError(error);
    }
  }

  async expirePendingIntents(command: ExpirePendingIntentsCommand): Promise<number> {
    return this.db.transaction(async (tx) => {
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
    intent: UploadIntent,
  ): Promise<FileRow | null> {
    const [file] = await tx
      .insert(files)
      .values({
        entryId,
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
    intent: UploadIntent,
  ): Promise<EntryRow | null> {
    if (intent.operation !== 'create' || intent.fileName === null) {
      throw new Error('Create upload intent is missing create metadata');
    }

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
      .set({ status: 'completed', fileId: entryId, completedAt })
      .where(eq(uploadIntents.id, intentId));
  }

  private async markIntentSuperseded(
    tx: Transaction,
    intentId: number,
    objectKey: string,
  ): Promise<void> {
    const [superseded] = await tx
      .update(uploadIntents)
      .set({ status: 'superseded' })
      .where(and(eq(uploadIntents.id, intentId), eq(uploadIntents.status, 'pending')))
      .returning({ id: uploadIntents.id });

    if (!superseded) {
      throw new Error('Failed to supersede upload intent');
    }

    await enqueueObjectDeletionsInTransaction(tx, [{ objectKey, reason: 'superseded_upload' }]);
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
      operation: row.operation,
      targetFileId: row.targetFileId,
      expectedContentVersion: row.expectedContentVersion,
    };
  }

  private toPendingInsert(upload: UploadIntentInput): typeof uploadIntents.$inferInsert {
    return {
      uploadId: upload.uploadId,
      createdByUserId: upload.createdByUserId,
      objectKey: upload.objectKey,
      contentType: upload.contentType,
      expectedSizeBytes: upload.expectedSizeBytes,
      expectedSha256: upload.expectedSha256,
      status: 'pending',
      createdAt: upload.createdAt,
      uploadUrlExpiresAt: upload.uploadUrlExpiresAt,
      finalizeDeadline: upload.finalizeDeadline,
    };
  }
}
