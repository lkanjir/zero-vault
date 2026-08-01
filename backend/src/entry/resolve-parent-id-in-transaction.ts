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

  const parent = await lockActiveParentInTransaction(tx, ownerId, eq(entries.publicId, parentId));
  return parent.id;
}

export async function resolveParentPublicIdInTransaction(
  tx: Transaction,
  ownerId: number,
  paretnId: number,
): Promise<string> {
  const parent = await lockActiveParentInTransaction(tx, ownerId, eq(entries.id, paretnId));
  return parent.publicId;
}

async function lockActiveParentInTransaction(
  tx: Transaction,
  ownerId: number,
  identifierCondition: SQL,
): Promise<{ id: number; publicId: string }> {
  const [parent] = await tx
    .select({ id: entries.id, publicId: entries.publicId })
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

  return parent;
}
