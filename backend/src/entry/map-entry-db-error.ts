import { isUniqueViolation } from '../db/postgres-error.js';
import { DuplicateEntryNameError } from '../shared/errors/duplicate-entry-name-error.js';

const ACTIVE_SIBLING_NAME_CONSTRAINT = 'entries_owner_parent_name_active_key';

export function mapEntryDatabaseError(error: unknown): Error {
  if (isUniqueViolation(error, ACTIVE_SIBLING_NAME_CONSTRAINT)) {
    return new DuplicateEntryNameError();
  }

  return error instanceof Error ? error : new Error('Neočekivana greška');
}
