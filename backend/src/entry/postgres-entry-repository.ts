import type {
  CreateFolderCommand,
  DeleteEntryCommand,
  EntriesQuery,
  EntryListing,
  EntryListRecord,
  EntryRepository,
  ListedEntry,
  ResolvedFolderPath,
  UpdateEntryCommand,
} from './entry-repository.js';
import { eq, isNull, sql, and, or, gt, type SQL, ilike, asc, desc, lt } from 'drizzle-orm';
import { entries, files } from '../db/schema.js';
import { db, type Transaction } from '../db/db-client.js';
import type { EntryListCursor } from './entry-list-cursor.js';
import type { Folder } from '../folder/folder.js';
import type { Entry, EntryListSort } from './entry.js';
import { mapEntryDatabaseError } from './map-entry-db-error.js';
import { AppError } from '../shared/errors/api/app-error.js';
import { enqueueObjectDeletionInTransaction } from '../object-deletion/object-deletion-helpers.js';
import type { PostgresEntryAuthorizer } from '../authorization/postgres-entry-authorizer.js';
import type { AuthorizationAction } from '../authorization/authorization.js';

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

type EntryDeletionTarget =
  | {
      id: number;
      kind: 'folder';
    }
  | {
      id: number;
      kind: 'file';
      objectKey: string;
    };

export class PostgresEntryRepository implements EntryRepository {
  constructor(private readonly authorizer: PostgresEntryAuthorizer) {}

  readonly kindRankExpression = sql<number>`case when ${entries.kind} = 'folder' then 0 else 1 end`;
  readonly sortNameExpression = sql<string>`lower(${entries.name})`;
  readonly sortUpdatedAtExpression = sql<Date>`date_trunc('milliseconds', ${entries.updatedAt})`;

  async getEntries(query: EntriesQuery): Promise<EntryListing> {
    const resolvedFolder = await this.resolveFolderPath(query.ownerId, query.parentId);
    const cursorFilter = this.createCursorFilter(query.cursor);
    const ordering = this.createOrdering(query.sort);

    const condition: SQL[] = [
      eq(entries.ownerId, query.ownerId),
      resolvedFolder === null
        ? isNull(entries.parentId)
        : eq(entries.parentId, resolvedFolder.dbId),
      isNull(entries.deletedAt),
    ];

    if (query.search !== null) {
      const escapedSearch = query.search.replace(/[\\%_]/g, '\\$&');
      condition.push(ilike(entries.name, `%${escapedSearch}%`));
    }

    if (query.kind !== null) {
      condition.push(eq(entries.kind, query.kind));
    }

    if (cursorFilter) {
      condition.push(cursorFilter);
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
      .orderBy(...ordering)
      .limit(query.limit);

    return {
      entries: rows.map(toEntryListRecord),
      path: resolvedFolder?.path ?? [],
    };
  }

  async createFolder(command: CreateFolderCommand): Promise<Folder> {
    try {
      const folder = await db.transaction(async (tx) => {
        const parentId = await this.authorizer.authorizeParentForCreate(tx, {
          actorUserId: command.actorUserId,
          ownerId: command.actorUserId,
          parentPublicId: command.parentId,
        });

        return this.insertFolder(tx, command.actorUserId, command.name, parentId);
      });

      return this.toFolder(folder);
    } catch (error) {
      throw mapEntryDatabaseError(error);
    }
  }

  private async insertFolder(
    tx: Transaction,
    ownerId: number,
    name: string,
    parentId: number | null,
  ): Promise<Entry> {
    const [folder] = await tx
      .insert(entries)
      .values({
        kind: 'folder',
        name: name,
        ownerId: ownerId,
        parentId: parentId,
      })
      .returning();

    if (!folder) {
      throw new Error('Failed to create folder');
    }

    return folder;
  }

  async updateEntry(command: UpdateEntryCommand): Promise<ListedEntry> {
    const actions: AuthorizationAction[] = [];

    if (command.name !== undefined) {
      actions.push('entry:rename');
    }

    if (command.parentId !== undefined) {
      actions.push('entry:move');
    }

    try {
      return await db.transaction(async (tx) => {
        const sourceEntry = await this.authorizer.authorizeForUpdate(tx, {
          actorUserId: command.actorUserId,
          entryPublicId: command.entryId,
          actions,
        });

        const nextParentId =
          command.parentId === undefined
            ? sourceEntry.parentId
            : await this.authorizer.authorizeParentForCreate(tx, {
                actorUserId: command.actorUserId,
                ownerId: sourceEntry.ownerId,
                parentPublicId: command.parentId,
              });

        if (sourceEntry.kind === 'folder' && command.parentId !== undefined) {
          await this.assertFolderCanMove(tx, sourceEntry.id, nextParentId);
        }

        const updatedData: Partial<Entry> = {
          updatedAt: new Date(),
        };

        if (command.name !== undefined) {
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
              eq(entries.id, sourceEntry.id),
              eq(entries.ownerId, sourceEntry.ownerId),
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

  async deleteEntry(command: DeleteEntryCommand): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const entry = await this.authorizer.authorizeForUpdate(tx, {
          actorUserId: command.actorUserId,
          entryPublicId: command.entryId,
          actions: ['entry:delete'],
        });

        const target = await this.resolveEntryDeletionTarget(tx, entry);
        const deletedAt = new Date();

        await this.softDeleteEntry(tx, entry.ownerId, target.id, deletedAt);

        if (target.kind === 'file') {
          await enqueueObjectDeletionInTransaction(tx, {
            objectKey: target.objectKey,
            reason: 'deleted_file',
          });
        }
      });
    } catch (error) {
      throw mapEntryDatabaseError(error);
    }
  }

  private async resolveEntryDeletionTarget(
    tx: Transaction,
    entry: Entry,
  ): Promise<EntryDeletionTarget> {
    if (entry.kind === 'folder') {
      await this.assertFolderEmpty(tx, entry.ownerId, entry.id);
      return {
        id: entry.id,
        kind: 'folder',
      };
    }

    return {
      id: entry.id,
      kind: 'file',
      objectKey: await this.requireFileObjectKey(tx, entry.id),
    };
  }

  private async assertFolderEmpty(
    tx: Transaction,
    ownerId: number,
    folderId: number,
  ): Promise<void> {
    const [activeChild] = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          eq(entries.ownerId, ownerId),
          eq(entries.parentId, folderId),
          isNull(entries.deletedAt),
        ),
      )
      .limit(1);

    if (activeChild) {
      throw new AppError('folder_not_empty');
    }
  }

  private async requireFileObjectKey(tx: Transaction, entryId: number): Promise<string> {
    const [file] = await tx
      .select({ objectKey: files.objectKey })
      .from(files)
      .where(eq(files.entryId, entryId))
      .limit(1);

    if (!file) {
      throw new Error('File entry is missing metadata');
    }

    return file.objectKey;
  }

  private async softDeleteEntry(
    tx: Transaction,
    ownerId: number,
    entryId: number,
    deletedAt: Date,
  ): Promise<void> {
    const [deletedEntry] = await tx
      .update(entries)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(and(eq(entries.id, entryId), eq(entries.ownerId, ownerId), isNull(entries.deletedAt)))
      .returning({ id: entries.id });

    if (!deletedEntry) {
      throw new Error('Failed to delete entry');
    }
  }

  private async toListedEntryInTransaction(
    tx: Transaction,
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
    tx: Transaction,
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

  private async resolveFolderPath(
    ownerId: number,
    folderId: string | null,
  ): Promise<ResolvedFolderPath | null> {
    if (!folderId) {
      return null;
    }

    type FolderPathRow = {
      dbId: string;
      id: string;
      name: string;
      parentDbId: string | null;
      depth: number;
    };

    const result = await db.execute<FolderPathRow>(sql`
       WITH RECURSIVE folder_path AS (
        SELECT
          current_folder.id,
          current_folder.public_id,
          current_folder.name,
          current_folder.parent_id,
          0 AS depth,
          ARRAY[current_folder.id] AS visited_ids
        FROM entries current_folder
        WHERE current_folder.public_id = ${folderId}
          AND current_folder.owner_id = ${ownerId}
          AND current_folder.kind = 'folder'
          AND current_folder.deleted_at IS null

        UNION ALL

        SELECT
          parent_folder.id,
          parent_folder.public_id,
          parent_folder.name,
          parent_folder.parent_id,
          folder_path.depth + 1,
          folder_path.visited_ids || parent_folder.id
        FROM entries parent_folder
        JOIN folder_path
          ON parent_folder.id = folder_path.parent_id
        WHERE parent_folder.owner_id = ${ownerId}
          AND parent_folder.kind = 'folder'
          AND parent_folder.deleted_at IS null
          AND NOT (parent_folder.id = ANY(folder_path.visited_ids))
      )
      SELECT
        id::text AS "dbId",
        public_id AS "id",
        name,
        parent_id::text AS "parentDbId",
        depth
      FROM folder_path
      ORDER BY depth DESC
      `);

    if (result.rows.length === 0) {
      throw new AppError('folder_not_found');
    }

    const rootMostFolder = result.rows[0];
    const currentFolder = result.rows.at(-1);

    if (!rootMostFolder || !currentFolder) {
      throw new AppError('folder_not_found');
    }

    if (rootMostFolder.parentDbId !== null) {
      throw new AppError('folder_not_found');
    }

    const currentFolderDbId = Number(currentFolder.dbId);

    if (!Number.isSafeInteger(currentFolderDbId)) {
      throw new Error('Folder database ID is not a safe integer');
    }

    return {
      dbId: currentFolderDbId,
      path: result.rows.map((folder) => ({ id: folder.id, name: folder.name })),
    };
  }

  private createCursorFilter(cursor: EntryListCursor | null): SQL | undefined {
    if (cursor === null) {
      return undefined;
    }

    return or(
      gt(this.kindRankExpression, cursor.kindRank),
      and(eq(this.kindRankExpression, cursor.kindRank), this.createCursorPositionFilter(cursor)),
    );
  }

  private createCursorPositionFilter(cursor: EntryListCursor): SQL | undefined {
    switch (cursor.sort) {
      case 'name-asc':
        return or(
          gt(this.sortNameExpression, cursor.sortName),
          and(eq(this.sortNameExpression, cursor.sortName), gt(entries.id, cursor.entryId)),
        );

      case 'name-desc':
        return or(
          lt(this.sortNameExpression, cursor.sortName),
          and(eq(this.sortNameExpression, cursor.sortName), lt(entries.id, cursor.entryId)),
        );

      case 'updated-asc': {
        const updatedAt = new Date(cursor.updatedAt);
        return or(
          gt(this.sortUpdatedAtExpression, updatedAt),
          and(eq(this.sortUpdatedAtExpression, updatedAt), gt(entries.id, cursor.entryId)),
        );
      }

      case 'updated-desc': {
        const updatedAt = new Date(cursor.updatedAt);
        return or(
          lt(this.sortUpdatedAtExpression, updatedAt),
          and(eq(this.sortUpdatedAtExpression, updatedAt), lt(entries.id, cursor.entryId)),
        );
      }
    }
  }

  private createOrdering(sort: EntryListSort): SQL[] {
    switch (sort) {
      case 'name-asc':
        return [asc(this.kindRankExpression), asc(this.sortNameExpression), asc(entries.id)];
      case 'name-desc':
        return [asc(this.kindRankExpression), desc(this.sortNameExpression), desc(entries.id)];
      case 'updated-asc':
        return [asc(this.kindRankExpression), asc(this.sortUpdatedAtExpression), asc(entries.id)];
      case 'updated-desc':
        return [asc(this.kindRankExpression), desc(this.sortUpdatedAtExpression), desc(entries.id)];
    }
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
        updatedAt: row.updatedAt.toISOString(),
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
      updatedAt: row.updatedAt.toISOString(),
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
