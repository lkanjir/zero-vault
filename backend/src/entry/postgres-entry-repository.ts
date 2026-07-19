import type {
  CreateFolderCommand,
  EntriesQuery,
  EntryListing,
  EntryListRecord,
  EntryRepository,
  ListedEntry,
  ResolvedFolderContext,
  UpdateEntryCommand,
} from './entry-repository.js';
import {
  eq,
  isNull,
  sql,
  and,
  or,
  gt,
  type SQL,
  type ExtractTablesWithRelations,
} from 'drizzle-orm';
import { entries, files } from '../db/schema.js';
import { db } from '../db/db-client.js';
import type { EntryListCursor } from './entry-list-cursor.js';
import type { Folder } from '../folder/folder.js';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { alias, type PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from '../db/schema.js';
import type { Entry } from './entry.js';
import { resolveParentIdInTransaction } from './resolve-parent-id-in-transaction.js';
import { mapEntryDatabaseError } from './map-entry-db-error.js';
import { AppError } from '../shared/errors/api/app-error.js';

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
  readonly sortNameExpression = sql<string>`lower(${entries.name})`;

  async getEntries(query: EntriesQuery): Promise<EntryListing> {
    const currentFolder = await this.resolveFolderContext(query.ownerId, query.parentId);
    const filter = this.createFilter(query.cursor);

    const condition: SQL[] = [
      eq(entries.ownerId, query.ownerId),
      currentFolder === null ? isNull(entries.parentId) : eq(entries.parentId, currentFolder.dbId),
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
        sortName: this.sortNameExpression,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
      })
      .from(entries)
      .leftJoin(files, eq(files.entryId, entries.id))
      .where(and(...condition))
      .orderBy(this.kindRankExpression, this.sortNameExpression, entries.id)
      .limit(query.limit);

    return {
      entries: rows.map(toEntryListRecord),
      currentFolder:
        currentFolder == null
          ? null
          : { id: currentFolder.id, name: currentFolder.name, parentId: currentFolder.parentId },
    };
  }

  async createFolder(command: CreateFolderCommand): Promise<Folder> {
    const targetParentFolder = await this.resolveFolderContext(command.ownerId, command.parentId);
    const folder = await this.insertFolder(
      command.ownerId,
      command.name,
      targetParentFolder?.dbId ?? null,
    );
    return this.toFolder(folder);
  }

  private async insertFolder(owner: number, name: string, parent: number | null): Promise<Entry> {
    try {
      const [folder] = await db
        .insert(entries)
        .values({
          kind: 'folder',
          name: name,
          ownerId: owner,
          parentId: parent,
        })
        .returning();

      if (!folder) {
        throw new Error('Failed to create folder');
      }

      return folder;
    } catch (error) {
      throw mapEntryDatabaseError(error);
    }
  }

  async updateEntry(command: UpdateEntryCommand): Promise<ListedEntry> {
    try {
      return db.transaction(async (tx) => {
        const target = await this.findEntryForUpdate(tx, command.ownerId, command.entryId);
        const nextParentId =
          command.parentId === undefined
            ? target.parentId
            : await resolveParentIdInTransaction(tx, command.ownerId, command.parentId);

        if (target.kind === 'folder' && command.parentId !== undefined) {
          await this.assertFolderCanMove(tx, target.id, nextParentId);
        }

        const updatedData: Partial<Entry> = {
          updatedAt: new Date(),
        };

        if (command.name) {
          updatedData.name = command.name;
        }

        if (command.parentId !== undefined) {
          updatedData.parentId = nextParentId;
        }

        const [updatedEntry] = await tx
          .update(entries)
          .set(updatedData)
          .where(
            and(
              eq(entries.id, target.id),
              eq(entries.ownerId, command.ownerId),
              isNull(entries.deletedAt),
            ),
          )
          .returning();

        if (!updatedEntry) {
          throw new Error('Greška kod ažuriranja datoteke / direktorija');
        }

        return this.toListedEntryInTransaction(tx, updatedEntry);
      });
    } catch (error) {
      throw mapEntryDatabaseError(error);
    }
  }

  private async toListedEntryInTransaction(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    updatedEntry: Entry,
  ): Promise<ListedEntry> {
    if (updatedEntry.kind === 'folder') {
      return {
        kind: 'folder',
        id: updatedEntry.publicId,
        name: updatedEntry.name,
        updatedAt: updatedEntry.updatedAt,
      };
    }

    const [file] = await tx
      .select({
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
      })
      .from(files)
      .where(eq(files.entryId, updatedEntry.id))
      .limit(1);

    if (!file) {
      throw new Error('File entry is missing file metadata');
    }

    return {
      kind: 'file',
      id: updatedEntry.publicId,
      name: updatedEntry.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      updatedAt: updatedEntry.updatedAt,
    };
  }

  private async assertFolderCanMove(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    folderId: number,
    nextParentId: number | null,
  ) {
    if (nextParentId === null) return;
    if (folderId === nextParentId) {
      throw new AppError('move_would_create_cycle', {
        context: {
          folderId,
          nextParentId,
        },
      });
    }

    const result = await tx.execute<{ id: number }>(sql`
      with recursive descendants(id) as (
        select id
        from entries
        where id = ${folderId}

        union all

        select child.id
        from entries child
        join descendants d on child.parent_id = d.id
        where child.deleted_at is null
      )
      select id
      from descendants
      where id = ${nextParentId}
      limit 1`);

    if (result.rows.length > 0) {
      throw new AppError('move_would_create_cycle', {
        context: {
          folderId,
          nextParentId,
        },
      });
    }
  }

  private async findEntryForUpdate(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    ownerId: number,
    entryId: string,
  ): Promise<Entry> {
    const [entry] = await tx
      .select()
      .from(entries)
      .where(
        and(eq(entries.publicId, entryId), eq(entries.ownerId, ownerId), isNull(entries.deletedAt)),
      )
      .for('update')
      .limit(1);

    if (!entry) {
      throw new AppError('entry_not_found');
    }

    return entry;
  }

  private async resolveFolderContext(
    ownerId: number,
    folderId: string | null,
  ): Promise<ResolvedFolderContext | null> {
    if (!folderId) {
      return null;
    }

    const parentFolder = alias(entries, 'parent_folder');

    const [result] = await db
      .select({
        currentFolderDbId: entries.id,
        currentFolderPublicId: entries.publicId,
        currentFolderName: entries.name,
        parentFolderPublicId: parentFolder.publicId,
      })
      .from(entries)
      .leftJoin(parentFolder, eq(entries.parentId, parentFolder.id))
      .where(
        and(
          eq(entries.publicId, folderId),
          eq(entries.ownerId, ownerId),
          eq(entries.kind, 'folder'),
          isNull(entries.deletedAt),
        ),
      )
      .limit(1);

    if (!result) {
      throw new AppError('folder_not_found');
    }

    return {
      dbId: result.currentFolderDbId,
      id: result.currentFolderPublicId,
      name: result.currentFolderName,
      parentId: result.parentFolderPublicId,
    };
  }

  private createFilter(cursor: EntryListCursor | null): SQL | undefined {
    if (!cursor) {
      return undefined;
    }

    return or(
      gt(this.kindRankExpression, cursor.kindRank),
      and(
        eq(this.kindRankExpression, cursor.kindRank),
        gt(this.sortNameExpression, cursor.sortName),
      ),
      and(
        eq(this.kindRankExpression, cursor.kindRank),
        eq(this.sortNameExpression, cursor.sortName),
        gt(entries.id, cursor.entryId),
      ),
    );
  }

  private toFolder(row: typeof entries.$inferSelect): Folder {
    if (row.kind !== 'folder') {
      throw new Error('Expected folder entry, got file');
    }

    return {
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
      id: row.id,
      kind: row.kind,
      name: row.name,
      ownerId: row.ownerId,
      parentId: row.parentId,
      publicId: row.publicId,
      updatedAt: row.updatedAt,
    };
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
