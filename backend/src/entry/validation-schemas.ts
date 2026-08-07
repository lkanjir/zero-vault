import z from 'zod';
import { ENTRY_LIST_SORTS } from './entry.js';

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
  search: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null),
  kind: z
    .enum(['file', 'folder'])
    .optional()
    .transform((value) => value ?? null),
  sort: z.enum(ENTRY_LIST_SORTS).default('name-asc'),
});

export type EntriesListRequest = z.infer<typeof listEntriesQuerySchema>;

export const entryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\\/]+/.test(value), {
    error: 'Naziv datoteke ili direktorija ne smije sadržavati znak / ili \\',
  });

export const updateEntryBodySchema = z
  .object({
    name: entryNameSchema.optional(),
    parentId: z.uuid().nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    error: 'Potrebno je definirati barem jedno polje, name ili parentId',
  });

export type EntryUpdateRequest = z.infer<typeof updateEntryBodySchema>;

export const entryIdParamsSchema = z.object({
  entryId: z.uuid(),
});
