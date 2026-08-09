import type { RecordAuditEventCommand } from './audit-event.js';

export interface AuditRepository {
  record(command: RecordAuditEventCommand): Promise<void>;
}
