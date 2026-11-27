import { AppError } from '../shared/errors/api/app-error.js';

export const MAX_ENTRY_NAME_LENGTH = 500;
const MAX_RENAME_COUNTER = 100_000;
const PREFIX_COUNTER_BUFFER = 12;

export type SplitFileName = {
  base: string;
  extension: string;
};

export function splitFileName(fileName: string): SplitFileName {
  const lastDotIndex = fileName.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return { base: fileName, extension: '' };
  }

  return {
    base: fileName.slice(0, lastDotIndex),
    extension: fileName.slice(lastDotIndex),
  };
}

export function buildAutoRenamedFileName(fileName: string, counter: number): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new Error('Auto-rename counter must be a positive integer');
  }

  const { base, extension } = splitFileName(fileName);
  const counterSuffix = ` (${counter})`;
  const suffix = `${counterSuffix}${extension}`;

  if (base.length + suffix.length <= MAX_ENTRY_NAME_LENGTH) {
    return `${base}${suffix}`;
  }

  if (suffix.length < MAX_ENTRY_NAME_LENGTH) {
    const maxBaseLength = MAX_ENTRY_NAME_LENGTH - suffix.length;
    const truncatedBase = base.slice(0, maxBaseLength).trimEnd();
    if (truncatedBase.length > 0 && truncatedBase !== '.' && truncatedBase !== '..') {
      return `${truncatedBase}${suffix}`;
    }
  }

  const maxPrefixLength = MAX_ENTRY_NAME_LENGTH - counterSuffix.length;
  const truncatedFull = fileName.slice(0, maxPrefixLength).trimEnd();
  if (truncatedFull.length === 0) {
    throw new Error('Cannot construct a valid auto-renamed file name');
  }

  return `${truncatedFull}${counterSuffix}`;
}

export function getAutoRenameSearchPrefix(fileName: string): string {
  const { base, extension } = splitFileName(fileName);

  if (base.length + extension.length + PREFIX_COUNTER_BUFFER <= MAX_ENTRY_NAME_LENGTH) {
    return base;
  }

  if (extension.length + PREFIX_COUNTER_BUFFER < MAX_ENTRY_NAME_LENGTH) {
    const maxBaseLength = MAX_ENTRY_NAME_LENGTH - extension.length - PREFIX_COUNTER_BUFFER;
    const prefix = base.slice(0, Math.max(1, maxBaseLength)).trimEnd();
    if (prefix.length > 0) {
      return prefix;
    }
  }

  return fileName.slice(0, Math.min(fileName.length, 16));
}

export function pickAvailableFileName(
  fileName: string,
  takenLowerNames: ReadonlySet<string>,
): string {
  if (!takenLowerNames.has(fileName.toLowerCase())) {
    return fileName;
  }

  for (let counter = 1; counter <= MAX_RENAME_COUNTER; counter += 1) {
    const candidate = buildAutoRenamedFileName(fileName, counter);
    if (!takenLowerNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  throw new AppError('duplicate_entry_name');
}
