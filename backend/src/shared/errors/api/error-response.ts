import type { ErrorCode } from './error-catalog.js';
import type { ErrorDetails } from './validation-error-details.js';

export type ErrorResponse = {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: ErrorDetails;
};
