import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../db/db-client.js';
import { entries, fileGrants } from '../db/schema.js';
import type { Entry } from '../entry/entry.js';
import type { AuthorizationService } from './authorization-service.js';
import type { AuthorizationAction, EntryAuthorizationContext } from './authorization.js';
import { AppError } from '../shared/errors/api/app-error.js';
import { resolveParentIdInTransaction } from '../entry/resolve-parent-id-in-transaction.js';

export class PostgresEntryAuthorizer {
  constructor(private readonly authzService: AuthorizationService) {}

  async authorizeForUpdate(
    tx: Transaction,
    input: {
      actorUserId: number;
      entryPublicId: string;
      actions: readonly AuthorizationAction[];
    },
  ): Promise<Entry> {
    if (input.actions.length === 0) {
      throw new Error('Got empty actions array, expected at least one action');
    }

    const [entry] = await tx
      .select()
      .from(entries)
      .where(eq(entries.publicId, input.entryPublicId))
      .for('update')
      .limit(1);

    if (!entry) {
      throw new AppError('entry_not_found');
    }

    const grant = await this.findGrant(tx, entry, input.actorUserId);
    const now = new Date();
    const context: EntryAuthorizationContext = {
      scope: 'entry',
      actor: {
        userId: input.actorUserId,
      },
      resource: {
        id: entry.id,
        kind: entry.kind,
        ownerId: entry.ownerId,
        deletedAt: entry.deletedAt,
      },
      relationship: {
        grant,
      },
      environment: {
        now,
      },
    };

    for (const action of input.actions) {
      this.authzService.authorizeEntryContext({
        action: action,
        entryPublicId: input.entryPublicId,
        context: context,
      });
    }

    return entry;
  }

  async authorizeParentForCreate(
    tx: Transaction,
    input: { actorUserId: number; ownerId: number; parentPublicId: string | null },
  ): Promise<number | null> {
    if (input.parentPublicId === null) {
      this.authzService.authorizeDriveRoot({
        actorUserId: input.actorUserId,
        ownerId: input.ownerId,
        action: 'entry:create',
      });

      return null;
    }

    const parentId = await resolveParentIdInTransaction(tx, input.ownerId, input.parentPublicId);

    if (parentId === null) {
      throw new Error('Resolved parent folder is missing its database ID');
    }

    this.authzService.authorizeEntryContext({
      action: 'entry:create',
      entryPublicId: input.parentPublicId,
      context: {
        scope: 'entry',
        actor: {
          userId: input.actorUserId,
        },
        resource: {
          id: parentId,
          ownerId: input.ownerId,
          kind: 'folder',
          deletedAt: null,
        },
        relationship: {
          grant: null,
        },
        environment: {
          now: new Date(),
        },
      },
    });

    return parentId;
  }

  private async findGrant(tx: Transaction, entry: Entry, actorUserId: number) {
    if (entry.kind !== 'file' || entry.ownerId === actorUserId) return null;

    const [grant] = await tx
      .select({
        permission: fileGrants.permission,
        expiresAt: fileGrants.expiresAt,
      })
      .from(fileGrants)
      .where(and(eq(fileGrants.fileId, entry.id), eq(fileGrants.recipientUserId, actorUserId)))
      .limit(1);

    return grant ?? null;
  }
}
