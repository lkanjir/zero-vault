import z from 'zod';

export const listAuditEventsQuerySchema = z.object({
  cursor: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value) => value ?? null),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null),
});

export type ListAuditEventsRequest = z.infer<typeof listAuditEventsQuerySchema>;
