import { CursorPage, CursorPageQuery } from '../../shared/cursor';

export type AuditAction =
  | 'folder.created'
  | 'file.uploaded'
  | 'entry.renamed'
  | 'entry.moved'
  | 'entry.deleted'
  | 'file.content_replaced'
  | 'file.download_url_issued'
  | 'folder.archive_requested'
  | 'file.share_submitted'
  | 'file.share_updated'
  | 'file.share_revoked';

export type AuditEvent = {
  id: string;
  action: AuditAction;
  occurredAt: string;
  actor: {
    firstName: string;
    lastName: string;
    email: string;
  };
  entry: {
    kind: 'file' | 'folder';
    name: string;
    deleted: boolean;
  };
  details: Record<string, string | number | boolean | null>;
};

export type AuditEventList = CursorPage<AuditEvent>;

export type AuditEventQuery = CursorPageQuery & {
  search: string | null;
};

export type AuditStatistics = {
  period: {
    from: string;
    to: string;
  };
  total: number;
  entryChanges: number;
  downloadRequests: number;
  sharingChanges: number;
};
