import type { NextFunction, Response, Request } from 'express';
import type { RequestHandler } from 'express-serve-static-core';
import * as z from 'zod';

export function validateQuery<Schema extends z.ZodType>(
  schema: Schema,
  handler: (req: Request, res: Response, params: z.output<Schema>) => Promise<void> | void,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request query',
        details: z.flattenError(result.error),
      });
      return;
    }

    try {
      await handler(req, res, result.data);
    } catch (error) {
      next(error);
    }
  };
}
