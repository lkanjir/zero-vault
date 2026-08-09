import type {
  AssertReplacementTargetAvailableCommand,
  AssertUploadTargetAvailableCommand,
  CompletedUploadFile,
  CompletedVerifiedUploadResult,
  CompleteVerifiedUploadCommand,
  ExpirePendingIntentsCommand,
  SaveReplacementUploadIntentCommand,
  SaveUploadIntentCommand,
  UploadIntentRepository,
} from './upload-intent-repository.js';
import type { UploadIntent, UploadIntentInput } from './upload-intent.js';
import { db, type Transaction } from '../db/db-client.js';
import { entries, files, uploadIntents } from '../db/schema.js';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { mapEntryDatabaseError } from '../entry/map-entry-db-error.js';
import { AppError } from '../shared/errors/api/app-error.js';
import { enqueueObjectDeletionsInTransaction } from '../object-deletion/object-deletion-helpers.js';
import type { PostgresEntryAuthorizer } from '../authorization/postgres-entry-authorizer.js';
import { recordAuditEventInTransaction } from '../audit/record-audit-event-in-transaction.js';

type UploadIntentRow = typeof uploadIntents.$inferSelect;
type EntryRow = typeof entries.$inferSelect;
type FileRow = typeof files.$inferSelect;

export class PostgresIntentRepository implements UploadIntentRepository {
  constructor(private readonly authorizer: PostgresEntryAuthorizer) {}

  async findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null> {
    const [row] = await db
      .select()
      .from(uploadIntents)
      .where(and(eq(uploadIntents.uploadId, uploadId), eq(uploadIntents.createdByUserId, userId)))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  async save(command: SaveUploadIntentCommand): Promise<void> {
    const upload = command.upload;

    await db.transaction(async (tx) => {
      const targetParentDbId = await this.authorizer.authorizeParentForCreate(tx, {
        actorUserId: upload.createdByUserId,
        ownerId: upload.createdByUserId,
        parentPublicId: command.parentFolderId,
      });

      await tx.insert(uploadIntents).values({
        ...this.toPendingInsert(upload),
        operation: 'create',
        fileName: command.fileName,
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
      case 'superseded':
        return { kind: 'superseded' };
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

    switch (intent.operation) {
      case 'create':
        return this.completePendingCreateIntent(tx, intent, command);
      case 'replace':
        return this.completePendingReplaceIntent(tx, intent, command);
    }
  }

  private async completePendingCreateIntent(
    tx: Transaction,
    intent: UploadIntentRow,
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult> {
    await this.authorizer.reauthorizeParentForCreate(tx, {
      actorUserId: command.userId,
      ownerId: command.userId,
      parentId: intent.targetParentId,
    });
    const entry = await this.createEntryForIntent(tx, command.userId, intent);

    if (!entry) {
      throw new Error('Greška kod kreiranja zapisa');
    }

    const file = await this.createFileForIntent(tx, entry.id, intent);

    if (!file) {
      throw new Error('Greška kod kreiranja datoteke');
    }

    await this.markIntentCompleted(tx, intent.id, file.entryId, command.completedAt);
    await recordAuditEventInTransaction(tx, {
      ownerId: entry.ownerId,
      actorUserId: command.userId,
      entryId: entry.id,
      entryNameSnapshot: entry.name,
      action: 'file.uploaded',
      details: {
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      },
      occurredAt: command.completedAt,
    });

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

  private async completePendingReplaceIntent(
    tx: Transaction,
    intent: UploadIntentRow,
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult> {
    const targetFileId = intent.targetFileId;
    const expectedContentVersion = intent.expectedContentVersion;

    if (targetFileId === null || expectedContentVersion === null) {
      throw new Error('Replace intent is missing replacement metadata');
    }

    const target = await this.authorizer.authorizeForUpdateByDbId(tx, {
      actorUserId: command.userId,
      entryDbId: targetFileId,
      actions: ['file:replace'],
    });

    const [currentFile] = await tx
      .select({ objectKey: files.objectKey, contentVersion: files.contentVersion })
      .from(files)
      .where(eq(files.entryId, target.id))
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
      .where(and(eq(files.entryId, target.id), eq(files.contentVersion, expectedContentVersion)))
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
      .set({ updatedAt: command.completedAt })
      .where(eq(entries.id, target.id))
      .returning({ publicId: entries.publicId, name: entries.name, updatedAt: entries.updatedAt });

    if (!updatedEntry) {
      throw new Error('Replacement target entry could not be updated');
    }

    await this.markIntentCompleted(tx, intent.id, updatedFile.entryId, command.completedAt);

    await enqueueObjectDeletionsInTransaction(tx, [
      {
        objectKey: currentFile.objectKey,
        reason: 'replaced_file',
      },
    ]);
    await recordAuditEventInTransaction(tx, {
      ownerId: target.ownerId,
      actorUserId: command.userId,
      entryId: target.id,
      entryNameSnapshot: updatedEntry.name,
      action: 'file.content_replaced',
      details: {
        previousContentVersion: currentFile.contentVersion,
        newContentVersion: updatedFile.contentVersion,
        contentType: updatedFile.contentType,
        sizeBytes: updatedFile.sizeBytes,
      },
      occurredAt: command.completedAt,
    });

    const completedFile: CompletedUploadFile = {
      entryId: updatedFile.entryId,
      publicId: updatedEntry.publicId,
      name: updatedEntry.name,
      contentType: updatedFile.contentType,
      sizeBytes: updatedFile.sizeBytes,
      updatedAt: updatedEntry.updatedAt,
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
      .set({ status: 'completed', fileId: entryId, completedAt: completedAt })
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

  async assertReplacementTargetAvailable(
    command: AssertReplacementTargetAvailableCommand,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await this.authorizer.authorizeForUpdate(tx, {
        actorUserId: command.userId,
        entryPublicId: command.filePublicId,
        actions: ['file:replace'],
      });
    });
  }

  async saveReplacement(command: SaveReplacementUploadIntentCommand): Promise<void> {
    const upload = command.upload;

    await db.transaction(async (tx) => {
      const target = await this.authorizer.authorizeForUpdate(tx, {
        actorUserId: upload.createdByUserId,
        entryPublicId: command.filePublicId,
        actions: ['file:replace'],
      });

      const [file] = await tx
        .select({ contentVersion: files.contentVersion })
        .from(files)
        .where(eq(files.entryId, target.id))
        .limit(1);

      if (!file) {
        throw new Error('Replacement target is missing file metadata');
      }

      await tx.insert(uploadIntents).values({
        ...this.toPendingInsert(upload),
        operation: 'replace',
        fileName: null,
        targetFileId: target.id,
        expectedContentVersion: file.contentVersion,
      });
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
      const targetParentDbId = await this.authorizer.authorizeParentForCreate(tx, {
        actorUserId: command.userId,
        ownerId: command.userId,
        parentPublicId: command.parentFolderId,
      });

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
