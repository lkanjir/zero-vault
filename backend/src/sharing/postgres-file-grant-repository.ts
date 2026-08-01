import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresEntryAuthorizer } from '../authorization/postgres-entry-authorizer.js';
import { db } from '../db/db-client.js';
import { fileGrants, users } from '../db/schema.js';
import type { FileGrantRepository, SaveFileGrantCommand } from './file-grant-repository.js';
import type { FileGrant } from './file-grant.js';

export class PostgresFileGrantRepository implements FileGrantRepository {
  constructor(private readonly authorizer: PostgresEntryAuthorizer) {}

  async save(command: SaveFileGrantCommand): Promise<FileGrant> {
    return db.transaction(async (tx) => {
      const file = await this.authorizer.authorizeForUpdate(tx, {
        actorUserId: command.actorUserId,
        entryPublicId: command.filePublicId,
        actions: ['share:manage'],
      });

      const [recipient] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${command.recipientEmail}`, isNull(users.deletedAt)))
        .for('share')
        .limit(1);

      const recipientUserId = recipient?.id ?? null;
      const activationDeadline =
        recipientUserId === null ? command.pendingActivationDeadline : null;

      const [existingRecipientGrant] =
        recipientUserId === null
          ? []
          : await tx
              .select({ id: fileGrants.id })
              .from(fileGrants)
              .where(
                and(
                  eq(fileGrants.fileId, file.id),
                  eq(fileGrants.recipientUserId, recipientUserId),
                ),
              )
              .for('update')
              .limit(1);

      if (existingRecipientGrant) {
        await tx
          .delete(fileGrants)
          .where(
            and(
              eq(fileGrants.fileId, file.id),
              eq(fileGrants.recipientEmail, command.recipientEmail),
              isNull(fileGrants.recipientUserId),
            ),
          );

        const [updatedGrant] = await tx
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

      const [savedGrant] = await tx
        .insert(fileGrants)
        .values({
          fileId: file.id,
          recipientUserId,
          recipientEmail: command.recipientEmail,
          createdByUserId: file.ownerId,
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
    });
  }
}
