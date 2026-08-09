export const auditActions = [
  'folder.created',
  'file.uploaded',
  'entry.renamed',
  'entry.moved',
  'entry.deleted',
  'file.content_replaced',
  'file.download_url_issued',
  'folder.archive_requested',
  'file.share_submitted',
  'file.share_updated',
  'file.share_revoked',
] as const;

export type AuditAction = (typeof auditActions)[number];

export const entryChangeAuditActions = [
  'folder.created',
  'file.uploaded',
  'entry.renamed',
  'entry.moved',
  'entry.deleted',
  'file.content_replaced',
] as const satisfies readonly AuditAction[];

export const downloadRequestAuditActions = [
  'file.download_url_issued',
  'folder.archive_requested',
] as const satisfies readonly AuditAction[];

export const sharingChangeAuditActions = [
  'file.share_submitted',
  'file.share_updated',
  'file.share_revoked',
] as const satisfies readonly AuditAction[];

export type AuditEventDetails = Record<string, string | number | boolean | null>;

export type RecordAuditEventCommand = {
  ownerId: number;
  actorUserId: number;
  entryId: number;
  entryNameSnapshot: string;
  action: AuditAction;
  details?: AuditEventDetails;
  occurredAt: Date;
};
