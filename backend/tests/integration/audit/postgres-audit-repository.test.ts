import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditRepository } from '../../../src/audit/audit-repository.js';
import { PostgresAuditRepository } from '../../../src/audit/postgres-audit-repository.js';
import { createDatabase, type Database } from '../../../src/db/db-client.js';
import { DrizzleUnitOfWork } from '../../../src/db/unit-of-work.js';
import { auditEvents, entries, users } from '../../../src/db/schema.js';

const ISSUER = 'https://issuer.example.test/realms/zero-vault';
let database: Database;

describe('PostgresAuditRepository', () => {
  let container: StartedPostgreSqlContainer;
  let closeDatabase: () => Promise<void>;
  let repository: AuditRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('zero_vault_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    const dbHandle = createDatabase({ connectionString: container.getConnectionUri() });
    database = dbHandle.db;
    closeDatabase = dbHandle.close;
    repository = new PostgresAuditRepository(database);

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(auditEvents);
    await database.delete(entries);
    await database.delete(users);
  });

  afterAll(async () => {
    await closeDatabase();
    await container.stop();
  });

  it('records and lists only the requested owners events with actor and deleted-entry context', async () => {
    const owner = await createUser('owner');
    const actor = await createUser('actor');
    const otherOwner = await createUser('other-owner');
    const entry = await createEntry(owner.id, 'current-name.txt');
    const otherEntry = await createEntry(otherOwner.id, 'other.txt');
    const deletedAt = new Date('2026-08-09T12:00:00.000Z');

    await repository.record({
      ownerId: owner.id,
      actorUserId: owner.id,
      entryId: entry.id,
      entryNameSnapshot: 'before-rename.txt',
      action: 'entry.renamed',
      details: { previousName: 'original.txt' },
      occurredAt: new Date('2026-08-09T10:00:00.000Z'),
    });
    await repository.record({
      ownerId: owner.id,
      actorUserId: actor.id,
      entryId: entry.id,
      entryNameSnapshot: 'before-delete.txt',
      action: 'entry.deleted',
      occurredAt: new Date('2026-08-09T11:00:00.000Z'),
    });
    await repository.record({
      ownerId: otherOwner.id,
      actorUserId: otherOwner.id,
      entryId: otherEntry.id,
      entryNameSnapshot: 'other.txt',
      action: 'file.uploaded',
      occurredAt: new Date('2026-08-09T12:00:00.000Z'),
    });
    await database.update(entries).set({ deletedAt }).where(eq(entries.id, entry.id));

    const result = await repository.listEvents({
      ownerId: owner.id,
      search: null,
      cursor: null,
      limit: 10,
    });

    expect(result).toHaveLength(2);
    expect(result.map((event) => event.action)).toStrictEqual(['entry.deleted', 'entry.renamed']);
    expect(result[0]).toMatchObject({
      actor: {
        firstName: 'Actor',
        lastName: 'User',
        email: 'actor@example.com',
      },
      entry: {
        kind: 'file',
        nameSnapshot: 'before-delete.txt',
        deletedAt,
      },
    });
    expect(result[1]?.details).toStrictEqual({ previousName: 'original.txt' });
  });

  it('uses event ID as a stable keyset tiebreaker for equal timestamps', async () => {
    const owner = await createUser('owner');
    const entry = await createEntry(owner.id, 'report.txt');
    const occurredAt = new Date('2026-08-09T10:00:00.000Z');

    for (const action of ['file.uploaded', 'entry.renamed', 'entry.deleted'] as const) {
      await repository.record({
        ownerId: owner.id,
        actorUserId: owner.id,
        entryId: entry.id,
        entryNameSnapshot: 'report.txt',
        action,
        occurredAt,
      });
    }

    const firstPage = await repository.listEvents({
      ownerId: owner.id,
      search: null,
      cursor: null,
      limit: 2,
    });
    const cursor = firstPage.at(-1)?.cursor;
    if (!cursor) {
      throw new Error('Expected a cursor source on the first audit page');
    }

    const secondPage = await repository.listEvents({
      ownerId: owner.id,
      search: null,
      cursor,
      limit: 2,
    });

    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]!.cursor.auditEventId).toBeLessThan(cursor.auditEventId);
    expect(secondPage.some((event) => firstPage.some((first) => first.id === event.id))).toBe(
      false,
    );
  });

  it('treats percent and underscore in search as literal characters', async () => {
    const owner = await createUser('owner');
    const entry = await createEntry(owner.id, 'budget.txt');

    await repository.record({
      ownerId: owner.id,
      actorUserId: owner.id,
      entryId: entry.id,
      entryNameSnapshot: 'Budget 100%_Final.txt',
      action: 'file.uploaded',
      occurredAt: new Date('2026-08-09T10:00:00.000Z'),
    });
    await repository.record({
      ownerId: owner.id,
      actorUserId: owner.id,
      entryId: entry.id,
      entryNameSnapshot: 'Budget 100xxFinal.txt',
      action: 'entry.renamed',
      occurredAt: new Date('2026-08-09T11:00:00.000Z'),
    });

    const result = await repository.listEvents({
      ownerId: owner.id,
      search: '100%_',
      cursor: null,
      limit: 10,
    });

    expect(result.map((event) => event.entry.nameSnapshot)).toStrictEqual([
      'Budget 100%_Final.txt',
    ]);
  });

  it('counts only the requested owners events in the half-open statistics period', async () => {
    const owner = await createUser('owner');
    const otherOwner = await createUser('other-owner');
    const entry = await createEntry(owner.id, 'report.txt');
    const otherEntry = await createEntry(otherOwner.id, 'other.txt');
    const from = new Date('2026-07-10T12:00:00.000Z');
    const to = new Date('2026-08-09T12:00:00.000Z');

    await recordAt(owner.id, entry.id, 'entry.renamed', new Date(from.getTime() - 1));
    await recordAt(owner.id, entry.id, 'folder.created', from);
    await recordAt(
      owner.id,
      entry.id,
      'file.download_url_issued',
      new Date('2026-08-01T12:00:00Z'),
    );
    await recordAt(owner.id, entry.id, 'file.share_updated', new Date(to.getTime() - 1));
    await recordAt(owner.id, entry.id, 'file.uploaded', to);
    await recordAt(
      otherOwner.id,
      otherEntry.id,
      'file.download_url_issued',
      new Date('2026-08-01T12:00:00Z'),
    );

    await expect(repository.getStatistics({ ownerId: owner.id, from, to })).resolves.toStrictEqual({
      total: 3,
      entryChanges: 1,
      downloadRequests: 1,
      sharingChanges: 1,
    });
  });

  it('enforces that the audited entry belongs to the recorded owner', async () => {
    const owner = await createUser('owner');
    const otherOwner = await createUser('other-owner');
    const entry = await createEntry(owner.id, 'report.txt');

    await expect(
      repository.record({
        ownerId: otherOwner.id,
        actorUserId: owner.id,
        entryId: entry.id,
        entryNameSnapshot: 'report.txt',
        action: 'entry.renamed',
        occurredAt: new Date('2026-08-09T10:00:00.000Z'),
      }),
    ).rejects.toBeDefined();

    await expect(database.select().from(auditEvents)).resolves.toHaveLength(0);
  });

  it('rolls back an audit event recorded inside a failed UnitOfWork transaction', async () => {
    const owner = await createUser('owner');
    const entry = await createEntry(owner.id, 'report.txt');
    const unitOfWork = new DrizzleUnitOfWork(database);

    await expect(
      unitOfWork.run(async (tx) => {
        await repository.record(
          {
            ownerId: owner.id,
            actorUserId: owner.id,
            entryId: entry.id,
            entryNameSnapshot: 'report.txt',
            action: 'entry.renamed',
            occurredAt: new Date('2026-08-09T10:00:00.000Z'),
          },
          tx,
        );

        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    await expect(database.select().from(auditEvents)).resolves.toHaveLength(0);
  });

  async function recordAt(
    ownerId: number,
    entryId: number,
    action: Parameters<AuditRepository['record']>[0]['action'],
    occurredAt: Date,
  ): Promise<void> {
    await repository.record({
      ownerId,
      actorUserId: ownerId,
      entryId,
      entryNameSnapshot: 'report.txt',
      action,
      occurredAt,
    });
  }
});

async function createUser(name: string) {
  const [user] = await database
    .insert(users)
    .values({
      issuer: ISSUER,
      subject: `${name}-subject`,
      email: `${name}@example.com`,
      firstName: toTitleCase(name),
      lastName: 'User',
    })
    .returning({ id: users.id });

  if (!user) {
    throw new Error('Failed to create audit test user');
  }

  return user;
}

async function createEntry(ownerId: number, name: string) {
  const [entry] = await database
    .insert(entries)
    .values({
      ownerId,
      parentId: null,
      kind: 'file',
      name,
    })
    .returning({ id: entries.id });

  if (!entry) {
    throw new Error('Failed to create audit test entry');
  }

  return entry;
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
