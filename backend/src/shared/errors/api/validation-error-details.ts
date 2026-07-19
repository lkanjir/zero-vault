import type { z } from 'zod';

export type ValidationIssue = {
  path: string[];
  code: z.core.$ZodIssue['code'];
  message: string;
};

export type ValidationErrorDetails = {
  issues: ValidationIssue[];
};

export type ErrorDetails = ValidationErrorDetails;
 