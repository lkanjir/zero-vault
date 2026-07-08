import z from 'zod';

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

export const entryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\\/]+/.test(value), {
    message: 'Folder name must not contain path separators',
  });

export const updateEntryBodySchema = z
  .object({
    name: entryNameSchema.optional(),
    parentId: z
      .uuid()
      .optional()
      .transform((val) => val ?? null),
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    message: 'Specify at least one filed, name or parentId',
  });

export type EntryUpdateRequest = z.infer<typeof updateEntryBodySchema>;

export const entryIdParamsSchema = z.object({
  entryId: z.uuid(),
});
