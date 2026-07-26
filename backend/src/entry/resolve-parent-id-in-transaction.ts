import { and, eq, isNull } from 'drizzle-orm';
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

  const [parent] = await tx
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.publicId, parentId),
        eq(entries.ownerId, ownerId),
        eq(entries.kind, 'folder'),
        isNull(entries.deletedAt),
      ),
    )
    .limit(1);

  if (!parent) {
    throw new AppError('folder_not_found');
  }

  return parent.id;
}
