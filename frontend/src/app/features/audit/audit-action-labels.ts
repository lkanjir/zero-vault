import { AuditAction } from '../../data-access/audit/audit-model';

export const AUDIT_ACTION_LABELS = {
  'folder.created': 'Kreiran direktorij',
  'file.uploaded': 'Prenesena datoteka',
  'entry.renamed': 'Promijenjen naziv',
  'entry.moved': 'Premješten zapis',
  'entry.deleted': 'Obrisan zapis',
  'file.content_replaced': 'Zamijenjen sadržaj',
  'file.download_url_issued': 'Zatraženo preuzimanje',
  'folder.archive_requested': 'Zatražena ZIP arhiva',
  'file.share_submitted': 'Dijeljenje poslano',
  'file.share_updated': 'Dijeljenje ažurirano',
  'file.share_revoked': 'Dijeljenje opozvano',
} as const satisfies Record<AuditAction, string>;
