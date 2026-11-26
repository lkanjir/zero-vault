import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/db-client.js';
import { requireTransaction, type TransactionContext } from '../db/unit-of-work.js';
import { entries, fileGrants, files, users } from '../db/schema.js';
import type {
  FileGrantMaintenanceResult,
  FileGrantRepository,
  ListFileGrantsQuery,
  ListOwnedSharedFilesQuery,
  ListSharedFilesQuery,
  MaintainPendingFileGrantsCommand,
  OwnedSharedFileRecord,
  RevokeFileGrantCommand,
  SaveFileGrantCommand,
  SharedFileRecord,
  UpdatedFileGrant,
  UpdateFileGrantCommand,
} from './file-grant-repository.js';
import type { FileGrant } from './file-grant.js';

export class PostgresFileGrantRepository implements FileGrantRepository {
  constructor(private readonly db: Database) {}

  async save(command: SaveFileGrantCommand, tx: TransactionContext): Promise<FileGrant> {
    const drizzleTx = requireTransaction(tx);

    const [recipient] = await drizzleTx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${command.recipientEmail}`, isNull(users.deletedAt)))
      .for('share')
      .limit(1);

    const recipientUserId = recipient?.id ?? null;
    const activationDeadline = recipientUserId === null ? command.pendingActivationDeadline : null;

    const [existingRecipientGrant] =
      recipientUserId === null
        ? []
        : await drizzleTx
            .select({ id: fileGrants.id })
            .from(fileGrants)
            .where(
              and(
                eq(fileGrants.fileId, command.fileId),
                eq(fileGrants.recipientUserId, recipientUserId),
              ),
            )
            .for('update')
            .limit(1);

    if (existingRecipientGrant) {
      await drizzleTx
        .delete(fileGrants)
        .where(
          and(
            eq(fileGrants.fileId, command.fileId),
            eq(fileGrants.recipientEmail, command.recipientEmail),
            isNull(fileGrants.recipientUserId),
          ),
        );

      const [updatedGrant] = await drizzleTx
        .update(fileGrants)
        .set({
          recipientEmail: command.recipientEmail,
          permission: command.permission,
          activationDeadline: null,
          expiresAt: command.expiresAt,
          updatedAt: command.submittedAt,
        })
        .where(eq(fileGrants.id, existingRecipientGrant.id))
        .returning();

      if (!updatedGrant) {
        throw new Error('File grant update failed');
      }

      return updatedGrant;
    }

    const [savedGrant] = await drizzleTx
      .insert(fileGrants)
      .values({
        fileId: command.fileId,
        recipientUserId,
        recipientEmail: command.recipientEmail,
        createdByUserId: command.createdByUserId,
        permission: command.permission,
        activationDeadline,
        expiresAt: command.expiresAt,
        createdAt: command.submittedAt,
        updatedAt: command.submittedAt,
      })
      .onConflictDoUpdate({
        target: [fileGrants.fileId, fileGrants.recipientEmail],
        set: {
          recipientUserId,
          permission: command.permission,
          activationDeadline,
          expiresAt: command.expiresAt,
          updatedAt: command.submittedAt,
        },
      })
      .returning();

    if (!savedGrant) {
      throw new Error('File grant save failed');
    }

    return savedGrant;
  }

  async listByFileId(query: ListFileGrantsQuery): Promise<FileGrant[]> {
    const cursorFilter =
      query.cursor === null
        ? undefined
        : or(
            gt(fileGrants.recipientEmail, query.cursor.recipientEmail),
            and(
              eq(fileGrants.recipientEmail, query.cursor.recipientEmail),
              gt(fileGrants.id, query.cursor.grantDbId),
            ),
          );

    return this.db
      .select()
      .from(fileGrants)
      .where(and(eq(fileGrants.fileId, query.fileId), cursorFilter))
      .orderBy(fileGrants.recipientEmail, fileGrants.id)
      .limit(query.limit);
  }

  async revoke(command: RevokeFileGrantCommand, tx: TransactionContext): Promise<FileGrant | null> {
    const drizzleTx = requireTransaction(tx);

    const [revokedGrant] = await drizzleTx
      .delete(fileGrants)
      .where(
        and(eq(fileGrants.fileId, command.fileId), eq(fileGrants.publicId, command.grantPublicId)),
      )
      .returning();

    return revokedGrant ?? null;
  }

  async update(
    command: UpdateFileGrantCommand,
    tx: TransactionContext,
  ): Promise<UpdatedFileGrant | null> {
    const drizzleTx = requireTransaction(tx);

    const [grant] = await drizzleTx
      .select()
      .from(fileGrants)
      .where(
        and(eq(fileGrants.fileId, command.fileId), eq(fileGrants.publicId, command.grantPublicId)),
      )
      .for('update')
      .limit(1);

    if (!grant) {
      return null;
    }

    const activationDeadline =
      grant.activationDeadline !== null &&
      command.expiresAt !== undefined &&
      command.expiresAt !== null &&
      command.expiresAt.getTime() < grant.activationDeadline.getTime()
        ? command.expiresAt
        : grant.activationDeadline;

    const [updatedGrant] = await drizzleTx
      .update(fileGrants)
      .set({
        permission: command.permission,
        expiresAt: command.expiresAt,
        activationDeadline,
        updatedAt: command.updatedAt,
      })
      .where(eq(fileGrants.id, grant.id))
      .returning();

    if (!updatedGrant) {
      throw new Error('File grant update failed');
    }

    return {
      previous: grant,
      updated: updatedGrant,
    };
  }

  maintainPending(command: MaintainPendingFileGrantsCommand): Promise<FileGrantMaintenanceResult> {
    return this.db.transaction(async (tx) => {
      const deletedCount = await this.deleteExpiredPendingGrants(tx, command);
      const activatedCount = await this.activatePendingGrants(tx, command);

      return {
        activatedCount,
        deletedCount,
      };
    });
  }

  private async deleteExpiredPendingGrants(
    tx: Transaction,
    command: MaintainPendingFileGrantsCommand,
  ): Promise<number> {
    const candidates = await tx
      .select({ id: fileGrants.id })
      .from(fileGrants)
      .where(
        and(
          isNull(fileGrants.recipientUserId),
          lte(fileGrants.activationDeadline, command.processedAt),
        ),
      )
      .orderBy(fileGrants.activationDeadline, fileGrants.id)
      .for('update', { skipLocked: true })
      .limit(command.limit);

    if (candidates.length === 0) {
      return 0;
    }

    const deleted = await tx
      .delete(fileGrants)
      .where(
        and(
          inArray(
            fileGrants.id,
            candidates.map((candidate) => candidate.id),
          ),
          isNull(fileGrants.recipientUserId),
          lte(fileGrants.activationDeadline, command.processedAt),
        ),
      )
      .returning({ id: fileGrants.id });

    if (deleted.length !== candidates.length) {
      throw new Error('Failed to delete all locked pending file grants');
    }

    return deleted.length;
  }

  private async activatePendingGrants(
    tx: Transaction,
    command: MaintainPendingFileGrantsCommand,
  ): Promise<number> {
    const activated = await tx.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT
          pending.id,
          recipient.id AS recipient_user_id
        FROM file_grants pending
        JOIN users recipient
          ON recipient.email = pending.recipient_email
          AND recipient.deleted_at IS NULL
        WHERE pending.recipient_user_id IS NULL
          AND pending.activation_deadline > ${command.processedAt}
        ORDER BY pending.activation_deadline, pending.id
        FOR UPDATE OF pending SKIP LOCKED
        LIMIT ${command.limit}
      )
      UPDATE file_grants pending
      SET
        recipient_user_id = candidates.recipient_user_id,
        activation_deadline = NULL,
        updated_at = ${command.processedAt}
      FROM candidates
      WHERE pending.id = candidates.id
        AND pending.recipient_user_id IS NULL
        AND pending.activation_deadline > ${command.processedAt}
      RETURNING pending.id::text AS id
    `);

    return activated.rows.length;
  }

  async listSharedFiles(query: ListSharedFilesQuery): Promise<SharedFileRecord[]> {
    const sortName = sql<string>`lower(${entries.name})`;

    const cursorFilter =
      query.cursor === null
        ? undefined
        : or(
            gt(sortName, query.cursor.sortName),
            and(eq(sortName, query.cursor.sortName), gt(entries.id, query.cursor.entryId)),
          );

    return this.db
      .select({
        file: {
          id: entries.publicId,
          name: entries.name,
          contentType: files.contentType,
          sizeBytes: files.sizeBytes,
          updatedAt: entries.updatedAt,
        },
        owner: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        },
        grant: {
          permission: fileGrants.permission,
          expiresAt: fileGrants.expiresAt,
        },
        cursor: {
          sortName,
          entryId: entries.id,
        },
      })
      .from(fileGrants)
      .innerJoin(entries, eq(entries.id, fileGrants.fileId))
      .innerJoin(files, eq(files.entryId, entries.id))
      .innerJoin(users, eq(users.id, entries.ownerId))
      .where(
        and(
          eq(fileGrants.recipientUserId, query.recipientUserId),
          eq(entries.kind, 'file'),
          isNull(entries.deletedAt),
          or(isNull(fileGrants.expiresAt), gt(fileGrants.expiresAt, query.listedAt)),
          cursorFilter,
        ),
      )
      .orderBy(sortName, entries.id)
      .limit(query.limit);
  }

  listOwnedSharedFiles(query: ListOwnedSharedFilesQuery): Promise<OwnedSharedFileRecord[]> {
    const sortName = sql<string>`lower(${entries.name})`;
    const shareCount = sql<number>`count(${fileGrants.id})::integer`;

    const cursorFilter =
      query.cursor === null
        ? undefined
        : or(
            gt(sortName, query.cursor.sortName),
            and(eq(sortName, query.cursor.sortName), gt(entries.id, query.cursor.entryId)),
          );

    return this.db
      .select({
        file: {
          id: entries.publicId,
          name: entries.name,
          contentType: files.contentType,
          sizeBytes: files.sizeBytes,
          updatedAt: entries.updatedAt,
        },
        shareCount,
        cursor: {
          sortName,
          entryId: entries.id,
        },
      })
      .from(entries)
      .innerJoin(files, eq(files.entryId, entries.id))
      .innerJoin(fileGrants, eq(fileGrants.fileId, entries.id))
      .where(
        and(
          eq(entries.ownerId, query.ownerId),
          eq(entries.kind, 'file'),
          isNull(entries.deletedAt),
          cursorFilter,
        ),
      )
      .groupBy(entries.id, files.entryId)
      .orderBy(sortName, entries.id)
      .limit(query.limit);
  }
}
