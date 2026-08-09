import type { Transaction } from '../db/db-client.js';
import { auditEvents } from '../db/schema.js';
import type { RecordAuditEventCommand } from './audit-event.js';

export async function recordAuditEventInTransaction(
  tx: Transaction,
  command: RecordAuditEventCommand,
): Promise<void> {
  await tx.insert(auditEvents).values({
    ownerId: command.ownerId,
    actorUserId: command.actorUserId,
    entryId: command.entryId,
    entryNameSnapshot: command.entryNameSnapshot,
    action: command.action,
    details: command.details ?? {},
    occurredAt: command.occurredAt,
  });
}
