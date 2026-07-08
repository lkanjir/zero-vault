import type { RequestHandler, Request, Response, NextFunction } from 'express';
import z from 'zod';

type RequestSchemas = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

type InferRequest<Schemas extends RequestSchemas> = {
  [Key in keyof Schemas]: Schemas[Key] extends z.ZodType ? z.output<Schemas[Key]> : never;
};

export function validateRequest<Schemas extends RequestSchemas>(
  schemas: Schemas,
  handler: (req: Request, res: Response, validated: InferRequest<Schemas>) => Promise<void> | void,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const validated: Partial<Record<keyof RequestSchemas, unknown>> = {};

    for (const [location, schema] of Object.entries(schemas) as [
      keyof RequestSchemas,
      z.ZodType,
    ][]) {
      const result = schema.safeParse(req[location]);

      if (!result.success) {
        res.status(400).json({
          error: `Invalid request ${location}`,
          code: `invalid_request_${location}`,
          details: z.flattenError(result.error),
        });
        return;
      }

      validated[location] = result.data;
    }

    try {
      await handler(req, res, validated as InferRequest<Schemas>);
    } catch (error) {
      next(error);
    }
  };
}
