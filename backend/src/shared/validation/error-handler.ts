import type { ErrorRequestHandler } from 'express';
import type { BodyParserError } from './body-parser-error.js';
import { AppError } from '../errors/app-error.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isJsonParseError(error)) {
    res.status(400).json({
      error: 'Invalid JSON',
      code: 'invalid_json',
    });
    return;
  }

  if (error instanceof AppError) {
    for (const [name, value] of Object.entries(error.headers)) {
      res.setHeader(name, value);
    }

    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });

    return;
  }

  console.error(error);
  res.status(500).json({
    error: 'Internal server error',
    code: 'internal_server_error',
  });
};

function isJsonParseError(error: unknown): error is BodyParserError {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const jsonError = error as BodyParserError;
  return jsonError.status === 400 && jsonError.type === 'entity.parse.failed';
}
