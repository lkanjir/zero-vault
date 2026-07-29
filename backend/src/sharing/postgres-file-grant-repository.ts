import { and, eq } from 'drizzle-orm';
import { db } from '../db/db-client.js';
import { fileGrants } from '../db/schema.js';
import type { FileGrantRepository, FindFileGrantCommand } from './file-grant-repository.js';
import type { FileGrant } from './file-grant.js';

export class PostgresFileGrantRepository implements FileGrantRepository {
  async findByFileAndRecipient(command: FindFileGrantCommand): Promise<FileGrant | null> {
    const [row] = await db
      .select()
      .from(fileGrants)
      .where(
        and(
          eq(fileGrants.fileId, command.fileId),
          eq(fileGrants.recipientUserId, command.recipientUserId),
        ),
      )
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  private toDomain(row: typeof fileGrants.$inferSelect): FileGrant {
    return {
      id: row.id,
      publicId: row.publicId,
      fileId: row.fileId,
      recipientUserId: row.recipientUserId,
      createdByUserId: row.createdByUserId,
      permission: row.permission,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
