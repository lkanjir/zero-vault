const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatFileSize(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '-';

  let unitIndex = 0;

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const formattedValue = new Intl.NumberFormat('hr-HR', {
    maximumFractionDigits: value < 10 && unitIndex > 0 ? 1 : 0,
  }).format(value);

  return `${formattedValue} ${UNITS[unitIndex]}`;
}
