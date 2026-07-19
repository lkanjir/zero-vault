import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/api/app-error.js';
import { getErrorDefinition } from '../errors/api/error-catalog.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = normalizeError(error);

  const definition = getErrorDefinition(appError.code);

  for (const [name, value] of Object.entries(definition.headers ?? {})) {
    res.setHeader(name, value);
  }

  res.status(definition.status).json({
    code: appError.code,
    message: definition.message,
    requestId: req.id,
    ...(appError.options.details ? { details: appError.options.details } : {}),
  });
};

function normalizeError(error: unknown): AppError {
  if (isBodyParserError(error, 'entity.parse.failed', 400)) {
    return new AppError('invalid_json', { cause: error });
  }

  if (isBodyParserError(error, 'entity.too.large', 413)) {
    return new AppError('request_body_too_large', { cause: error });
  }

  if (error instanceof AppError) {
    return error;
  }

  return new AppError('internal_server_error', { cause: error });
}

function isBodyParserError(error: unknown, type: string, status: number): boolean {
  return (
    error instanceof Error &&
    'type' in error &&
    error.type === type &&
    'status' in error &&
    error.status === status
  );
}
