import z from 'zod';

export const fileIdParamsSchema = z.object({
  fileId: z.uuid(),
});

export const listEntriesQuerySchema = z.object({
  parentId: z
    .uuid()
    .optional()
    .transform((val) => val ?? null),
  cursor: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((val) => val ?? null),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type EntriesListRequest = z.infer<typeof listEntriesQuerySchema>;
