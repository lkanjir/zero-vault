import type { EntriesQuery, EntryListRecord, EntryRepository } from './entry-repository.js';
import { eq, isNull, sql, and, or, gt, type SQL } from 'drizzle-orm';
import { entries, files } from '../db/schema.js';
import { db } from '../db/db-client.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';
import type { EntryListCursor } from './entry-list-cursor.js';

type QueryDbRow = {
  entryId: number;
  id: string;
  kind: 'file' | 'folder';
  name: string;
  updatedAt: Date;
  sortName: string;
  contentType: string | null;
  sizeBytes: number | null;
};

export class PostgresEntryRepository implements EntryRepository {
  readonly kindRankExpression = sql<number>`case when ${entries.kind} = 'folder' then 0 else 1 end`;
  readonly sortNameExpresssion = sql<string>`lower(${entries.name})`;

  async getEntries(query: EntriesQuery): Promise<EntryListRecord[]> {
    const parentDbId = await this.resolveParentId(query.ownerId, query.parentId);
    const filter = this.createFilter(query.cursor);

    const condition: SQL[] = [
      eq(entries.ownerId, query.ownerId),
      parentDbId === null ? isNull(entries.parentId) : eq(entries.parentId, parentDbId),
      isNull(entries.deletedAt),
    ];

    if (filter) {
      condition.push(filter);
    }

    const rows = await db
      .select({
        entryId: entries.id,
        id: entries.publicId,
        kind: entries.kind,
        name: entries.name,
        updatedAt: entries.updatedAt,
        sortName: this.sortNameExpresssion,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
      })
      .from(entries)
      .leftJoin(files, eq(files.entryId, entries.id))
      .where(and(...condition))
      .orderBy(this.kindRankExpression, this.sortNameExpresssion, entries.id)
      .limit(query.limit);

    return rows.map(toEntryListRecord);
  }

  private async resolveParentId(
    ownerId: number,
    parentId: string | undefined,
  ): Promise<number | null> {
    if (!parentId) {
      return null;
    }

    const [parent] = await db
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
      throw new NotFoundError('Folder not found');
    }

    return parent.id;
  }

  private createFilter(cursor: EntryListCursor | null): SQL | undefined {
    if (!cursor) {
      return undefined;
    }

    return or(
      gt(this.kindRankExpression, cursor.kindRank),
      and(
        eq(this.kindRankExpression, cursor.kindRank),
        gt(this.sortNameExpresssion, cursor.sortName),
      ),
      and(
        eq(this.kindRankExpression, cursor.kindRank),
        eq(this.sortNameExpresssion, cursor.sortName),
        gt(entries.id, cursor.entryId),
      ),
    );
  }
}

function toEntryListRecord(row: QueryDbRow): EntryListRecord {
  if (row.kind === 'folder') {
    return {
      cursor: {
        kindRank: 0,
        sortName: row.sortName,
        entryId: row.entryId,
      },
      entry: {
        kind: 'folder',
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt,
      },
    };
  }

  if (row.contentType === null || row.sizeBytes === null) {
    throw new Error('File entry is missing file metadata');
  }

  return {
    cursor: {
      kindRank: 1,
      sortName: row.sortName,
      entryId: row.entryId,
    },
    entry: {
      kind: 'file',
      id: row.id,
      name: row.name,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      updatedAt: row.updatedAt,
    },
  };
}
