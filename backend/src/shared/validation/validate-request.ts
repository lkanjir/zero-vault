import { type RequestHandler, type Request, type Response, type NextFunction } from 'express';
import z from 'zod';
import { AppError } from '../errors/api/app-error.js';
import type { ErrorCode } from '../errors/api/error-catalog.js';
import { formatValidationError } from './format-validation-error.js';

z.config(z.locales.hr());

type RequestSchemas = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

type InferRequest<Schemas extends RequestSchemas> = {
  [Key in keyof Schemas]: Schemas[Key] extends z.ZodType ? z.output<Schemas[Key]> : never;
};

type RequestLocation = 'body' | 'params' | 'query';

const validationErrorCode = {
  body: 'invalid_request_body',
  params: 'invalid_request_params',
  query: 'invalid_request_query',
} as const satisfies Record<RequestLocation, ErrorCode>;

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
        next(
          new AppError(validationErrorCode[location], {
            details: formatValidationError(result.error),
          }),
        );

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
