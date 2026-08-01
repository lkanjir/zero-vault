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
