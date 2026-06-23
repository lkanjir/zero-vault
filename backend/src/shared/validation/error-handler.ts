import type { Request, Response, NextFunction } from 'express';
import type { BodyParserError } from './body-parser-error.js';

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  if (isJsonParseError(error)) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: 'Internal server error',
  });
}

function isJsonParseError(error: unknown): error is BodyParserError {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const jsonError = error as BodyParserError;
  return jsonError.status === 400 && jsonError.type === 'entity.parse.failed';
}
