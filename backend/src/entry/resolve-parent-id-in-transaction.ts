import { and, eq, isNull, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from '../db/schema.js';
import { entries } from '../db/schema.js';
import { AppError } from '../shared/errors/api/app-error.js';

export async function resolveParentIdInTransaction(
  tx: PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>,
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
