import type { ErrorRequestHandler } from 'express';
import type { BodyParserError } from './body-parser-error.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isJsonParseError(error)) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: 'Internal server error',
  });
};

function isJsonParseError(error: unknown): error is BodyParserError {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const jsonError = error as BodyParserError;
  return jsonError.status === 400 && jsonError.type === 'entity.parse.failed';
}
