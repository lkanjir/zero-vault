import type { EntryKind } from '../entry/entry.js';
import type { CursorPage } from '../shared/types/cursor-page.js';
import type { AuditAction, AuditEventDetails } from './audit-event.js';

export type AuditEventResponse = {
  id: string;
  action: AuditAction;
  occurredAt: string;
  actor: {
    firstName: string;
    lastName: string;
    email: string;
  };
  entry: {
    kind: EntryKind;
    name: string;
    deleted: boolean;
  };
  details: AuditEventDetails;
};

export type AuditEventListResponse = CursorPage<AuditEventResponse>;

export type AuditStatisticsResponse = {
  period: {
    from: string;
    to: string;
  };
  total: number;
  entryChanges: number;
  downloadRequests: number;
  sharingChanges: number;
};
