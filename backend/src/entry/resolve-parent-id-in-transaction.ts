import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { entries } from '../db/schema.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type { Transaction } from '../db/db-client.js';

export async function resolveParentIdInTransaction(
  tx: Transaction,
  ownerId: number,
  parentId: string | null,
): Promise<number | null> {
  if (parentId === null) {
    return null;
  }

  return lockActiveParentInTransaction(tx, ownerId, eq(entries.publicId, parentId));
}

export async function assertParentAvailableInTransaction(
  tx: Transaction,
  ownerId: number,
  parentId: number | null,
): Promise<void> {
  if (parentId === null) {
    return;
  }

  await lockActiveParentInTransaction(tx, ownerId, eq(entries.id, parentId));
}

async function lockActiveParentInTransaction(
  tx: Transaction,
  ownerId: number,
  identifierCondition: SQL,
): Promise<number> {
  const [parent] = await tx
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        identifierCondition,
        eq(entries.ownerId, ownerId),
        eq(entries.kind, 'folder'),
        isNull(entries.deletedAt),
      ),
    )
    .for('key share')
    .limit(1);

  if (!parent) {
    throw new AppError('folder_not_found');
  }

  return parent.id;
}
