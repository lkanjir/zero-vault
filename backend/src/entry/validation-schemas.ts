import z from 'zod';

export const listEntriesQuerySchema = z.object({
  parentId: z
    .uuid()
    .nullable()
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
    message: 'Naziv datoteke ili direktorija ne smije sadržavati znak / ili \\',
  });

export const updateEntryBodySchema = z
  .object({
    name: entryNameSchema.optional(),
    parentId: z.uuid().nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    message: 'Potrebno je definirati barem jedno polje, name ili parentId',
  });

export type EntryUpdateRequest = z.infer<typeof updateEntryBodySchema>;

export const entryIdParamsSchema = z.object({
  entryId: z.uuid(),
});
