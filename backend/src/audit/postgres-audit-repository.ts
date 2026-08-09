import { and, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../db/db-client.js';
import { auditEvents, entries, users } from '../db/schema.js';
import type { RecordAuditEventCommand } from './audit-event.js';
import type {
  AuditEventRecord,
  AuditRepository,
  ListAuditEventsQuery,
} from './audit-repository.js';

export class PostgresAuditRepository implements AuditRepository {
  async record(command: RecordAuditEventCommand): Promise<void> {
    await db.insert(auditEvents).values({
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

    return db
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
}
