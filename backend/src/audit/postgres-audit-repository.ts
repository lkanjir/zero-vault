import { and, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/db-client.js';
import type { TransactionContext } from '../db/unit-of-work.js';
import { auditEvents, entries, users } from '../db/schema.js';
import {
  downloadRequestAuditActions,
  entryChangeAuditActions,
  sharingChangeAuditActions,
  type RecordAuditEventCommand,
} from './audit-event.js';
import type {
  AuditEventRecord,
  AuditRepository,
  AuditStatistics,
  GetAuditStatisticsQuery,
  ListAuditEventsQuery,
} from './audit-repository.js';

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly db: Database) {}

  async record(command: RecordAuditEventCommand, tx?: TransactionContext): Promise<void> {
    await (tx ?? this.db).insert(auditEvents).values({
      ownerId: command.ownerId,
      actorUserId: command.actorUserId,
      entryId: command.entryId,
      entryNameSnapshot: command.entryNameSnapshot,
      action: command.action,
      details: command.details ?? {},
      occurredAt: command.occurredAt,
    });
  }

  async listEvents(query: ListAuditEventsQuery): Promise<AuditEventRecord[]> {
    const conditions: SQL[] = [eq(auditEvents.ownerId, query.ownerId)];

    if (query.search !== null) {
      const escapedSearch = query.search.replace(/[\\%_]/g, '\\$&');
      conditions.push(ilike(auditEvents.entryNameSnapshot, `%${escapedSearch}%`));
    }

    const cursorFilter =
      query.cursor === null
        ? undefined
        : or(
            lt(auditEvents.occurredAt, query.cursor.occurredAt),
            and(
              eq(auditEvents.occurredAt, query.cursor.occurredAt),
              lt(auditEvents.id, query.cursor.auditEventId),
            ),
          );

    if (cursorFilter) {
      conditions.push(cursorFilter);
    }

    return this.db
      .select({
        id: auditEvents.publicId,
        action: auditEvents.action,
        details: auditEvents.details,
        occurredAt: auditEvents.occurredAt,
        actor: {
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
        entry: {
          kind: entries.kind,
          nameSnapshot: auditEvents.entryNameSnapshot,
          deletedAt: entries.deletedAt,
        },
        cursor: {
          occurredAt: auditEvents.occurredAt,
          auditEventId: auditEvents.id,
        },
      })
      .from(auditEvents)
      .innerJoin(users, eq(users.id, auditEvents.actorUserId))
      .innerJoin(
        entries,
        and(eq(entries.id, auditEvents.entryId), eq(entries.ownerId, auditEvents.ownerId)),
      )
      .where(and(...conditions))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(query.limit);
  }

  async getStatistics(query: GetAuditStatisticsQuery): Promise<AuditStatistics> {
    const [statistics] = await this.db
      .select({
        total: sql<number>`count(*)::integer`,
        entryChanges: sql<number>`count(*) filter (
          where ${inArray(auditEvents.action, entryChangeAuditActions)}
        )::integer`,
        downloadRequests: sql<number>`count(*) filter (
          where ${inArray(auditEvents.action, downloadRequestAuditActions)}
        )::integer`,
        sharingChanges: sql<number>`count(*) filter (
          where ${inArray(auditEvents.action, sharingChangeAuditActions)}
        )::integer`,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.ownerId, query.ownerId),
          gte(auditEvents.occurredAt, query.from),
          lt(auditEvents.occurredAt, query.to),
        ),
      );

    if (!statistics) {
      throw new Error('Audit statistics query returned no result');
    }

    return statistics;
  }
}
