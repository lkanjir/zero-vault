import { isUniqueViolation } from '../db/postgres-error.js';
import { AppError } from '../shared/errors/api/app-error.js';

const ACTIVE_EMAIL_CONSTRAINT = 'users_active_email_key';

export function mapUserDatabaseError(error: unknown): Error {
  if (isUniqueViolation(error, ACTIVE_EMAIL_CONSTRAINT)) {
    return new AppError('user_identity_conflict', {
      cause: error,
      context: { constraint: ACTIVE_EMAIL_CONSTRAINT },
    });
  }

  return error instanceof Error ? error : new Error('Unexpected database error', { cause: error });
}
