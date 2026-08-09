import type { EntryKind } from '../entry/entry.js';
import type { AuditAction, AuditEventDetails, RecordAuditEventCommand } from './audit-event.js';

export type ListAuditEventsQuery = {
  ownerId: number;
  search: string | null;
  cursor: {
    occurredAt: Date;
    auditEventId: number;
  } | null;
  limit: number;
};

export type AuditEventRecord = {
  id: string;
  action: AuditAction;
  details: AuditEventDetails;
  occurredAt: Date;
  actor: {
    firstName: string;
    lastName: string;
    email: string;
  };
  entry: {
    kind: EntryKind;
    nameSnapshot: string;
    deletedAt: Date | null;
  };
  cursor: {
    occurredAt: Date;
    auditEventId: number;
  };
};

export type GetAuditStatisticsQuery = {
  ownerId: number;
  from: Date;
  to: Date;
};

export type AuditStatistics = {
  total: number;
  entryChanges: number;
  downloadRequests: number;
  sharingChanges: number;
};

export interface AuditRepository {
  record(command: RecordAuditEventCommand): Promise<void>;
  listEvents(query: ListAuditEventsQuery): Promise<AuditEventRecord[]>;
  getStatistics(query: GetAuditStatisticsQuery): Promise<AuditStatistics>;
}
