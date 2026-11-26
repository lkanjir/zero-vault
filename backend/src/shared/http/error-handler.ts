import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/api/app-error.js';
import { getErrorDefinition } from '../errors/api/error-catalog.js';
import type { ErrorResponse } from '../errors/api/error-response.js';
import { StorageError } from '../errors/storage/storage-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = normalizeError(error);
  const definition = getErrorDefinition(appError.code);

  if (definition.status >= 500) {
    console.error('HTTP request failed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: definition.status,
      code: appError.code,
      context: appError.options.context,
      error: appError.options.cause ?? error,
    });
  }

  for (const [name, value] of Object.entries(definition.headers ?? {})) {
    res.setHeader(name, value);
  }

  const response = {
    code: appError.code,
    message: definition.message,
    requestId: req.id,
    ...(appError.options.details !== undefined ? { details: appError.options.details } : {}),
  } as const satisfies ErrorResponse;

  res.status(definition.status).json(response);
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

  if (error instanceof StorageError) {
    return new AppError('storage_unavailable', {
      cause: error,
      context: {
        storageOperation: error.context.operation,
        ...(error.context.objectKey !== undefined ? { objectKey: error.context.objectKey } : {}),
      },
    });
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
