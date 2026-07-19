import { isUniqueViolation } from '../db/postgres-error.js';
import { AppError } from '../shared/errors/api/app-error.js';

const ACTIVE_SIBLING_NAME_CONSTRAINT = 'entries_owner_parent_name_active_key';

export function mapEntryDatabaseError(error: unknown): Error {
  if (isUniqueViolation(error, ACTIVE_SIBLING_NAME_CONSTRAINT)) {
    return new AppError('duplicate_entry_name', {
      cause: error,
      context: {
        constraint: ACTIVE_SIBLING_NAME_CONSTRAINT,
      },
    });
  }

  return error instanceof Error ? error : new Error('Unexpected database error', { cause: error });
}
