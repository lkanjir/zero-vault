import type { ZodError } from 'zod';
import type { ErrorDetails } from '../errors/api/validation-error-details.js';

export function formatValidationError(error: ZodError): ErrorDetails {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String),
      code: issue.code,
      message: issue.message,
    })),
  };
}
