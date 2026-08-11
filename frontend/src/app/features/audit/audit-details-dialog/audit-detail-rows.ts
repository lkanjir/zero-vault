import { AuditEvent } from '../../../data-access/audit/audit-model';
import { formatFileSize } from '../../../shared/util/format-file-size';

export type AuditDetailRow = {
  label: string;
  value: string;
};

type DetailValue = string | number | boolean | null;
type DetailField = readonly [label: string, formatter: (value: DetailValue) => string];

const PERMISSION_LABELS = new Map<string, string>([
  ['viewer', 'Pregled'],
  ['editor', 'Uređivanje'],
]);

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('hr-HR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const DETAIL_FIELDS = new Map<string, DetailField>([
  ['contentType', ['Vrsta sadržaja', formatText]],
  ['sizeBytes', ['Veličina', formatSize]],
  ['previousName', ['Prethodni naziv', formatText]],
  ['sourceParentName', ['Iz direktorija', formatFolder]],
  ['destinationParentName', ['U direktorij', formatFolder]],
  ['previousContentVersion', ['Prethodna verzija', formatVersion]],
  ['newContentVersion', ['Nova verzija', formatVersion]],
  ['expiresInSeconds', ['Trajanje poveznice', formatDuration]],
  ['recipientEmail', ['Primatelj', formatText]],
  ['permission', ['Pristup', formatPermission]],
  ['expiresAt', ['Vrijeme isteka', formatExpiry]],
  ['previousPermission', ['Prethodni pristup', formatPermission]],
  ['newPermission', ['Novi pristup', formatPermission]],
  ['previousExpiresAt', ['Prethodno vrijeme isteka', formatExpiry]],
  ['newExpiresAt', ['Novo vrijeme isteka', formatExpiry]],
]);

export function createAuditDetailRows(event: AuditEvent): readonly AuditDetailRow[] {
  return Object.entries(event.details).flatMap(([key, value]) => {
    const field = DETAIL_FIELDS.get(key);

    if (!field) {
      return [];
    }

    const [label, formatter] = field;

    return [{ label, value: formatter(value) }];
  });
}

function formatText(value: DetailValue): string {
  return value === null ? '-' : String(value);
}

function formatPermission(value: DetailValue): string {
  return typeof value === 'string' ? (PERMISSION_LABELS.get(value) ?? '-') : '-';
}

function formatFolder(value: DetailValue): string {
  return value === null ? 'Moj disk' : typeof value === 'string' ? value : '-';
}

function formatSize(value: DetailValue): string {
  return typeof value === 'number' ? formatFileSize(value) : '-';
}

function formatVersion(value: DetailValue): string {
  return typeof value === 'number' ? `v${value}` : '-';
}

function formatDuration(value: DetailValue): string {
  return typeof value === 'number' ? `${value} sekundi` : '-';
}

function formatExpiry(value: DetailValue): string {
  if (value === null) {
    return 'Bez isteka';
  }

  if (typeof value !== 'string') {
    return '-';
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? DATE_TIME_FORMATTER.format(date) : '-';
}
