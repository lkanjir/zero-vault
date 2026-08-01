import z from 'zod';
import { normalizedEmailSchema } from '../shared/validation/normalized-email-schema.js';

export const fileIdParamsSchema = z.object({
  fileId: z.uuid(),
});

export const shareFileBodySchema = z.object({
  recipientEmail: normalizedEmailSchema,
  permission: z.enum(['viewer', 'editor']),
  expiresAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .nullable()
    .optional()
    .default(null),
});

export const listFileSharesQuerySchema = z.object({
  cursor: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value) => value ?? null),

  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListFileSharesRequest = z.infer<typeof listFileSharesQuerySchema>;
