import { and, eq } from 'drizzle-orm';
import { db } from '../db/db-client.js';
import { entries, fileGrants } from '../db/schema.js';
import type {
  AuthorizationContextResolver,
  ResolveEntryAuthorizationContextCommand,
} from './authorization-context-resolver.js';
import type { EntryAuthorizationContext } from './authorization.js';

export class PostgresAuthorizationContextResolver implements AuthorizationContextResolver {
  async resolveEntry(
    command: ResolveEntryAuthorizationContextCommand,
  ): Promise<EntryAuthorizationContext | null> {
    const [row] = await db
      .select({
        id: entries.id,
        ownerId: entries.ownerId,
        kind: entries.kind,
        deletedAt: entries.deletedAt,
        grantPermission: fileGrants.permission,
        grantExpiresAt: fileGrants.expiresAt,
      })
      .from(entries)
      .leftJoin(
        fileGrants,
        and(eq(fileGrants.fileId, entries.id), eq(fileGrants.recipientUserId, command.actorUserId)),
      )
      .where(eq(entries.publicId, command.entryPublicId))
      .limit(1);

    if (!row) {
      return null;
    }

    const grant =
      row.grantPermission === null
        ? null
        : {
            permission: row.grantPermission,
            expiresAt: row.grantExpiresAt,
          };

    return {
      scope: 'entry',
      actor: {
        userId: command.actorUserId,
      },
      resource: {
        id: row.id,
        ownerId: row.ownerId,
        kind: row.kind,
        deletedAt: row.deletedAt,
      },
      relationship: {
        grant,
      },
      environment: {
        now: command.now,
      },
    };
  }
}
