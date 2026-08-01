import { and, isNull, sql } from 'drizzle-orm';
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
