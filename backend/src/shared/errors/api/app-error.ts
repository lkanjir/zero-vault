import { errorCatalog, type ErrorCode } from './error-catalog.js';
import type { ErrorDetails } from './validation-error-details.js';

export type AppErrorOptions = {
  cause?: unknown;
  details?: ErrorDetails;
  context?: Record<string, string | number | boolean | null>;
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly options: AppErrorOptions = {},
  ) {
    super(errorCatalog[code].message, { cause: options.cause });
    this.name = new.target.name;
  }
}
