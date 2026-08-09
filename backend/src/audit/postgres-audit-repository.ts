import { db } from '../db/db-client.js';
import { auditEvents } from '../db/schema.js';
import type { RecordAuditEventCommand } from './audit-event.js';
import type { AuditRepository } from './audit-repository.js';

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
}
