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

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

export const entryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\\/]+/.test(value), {
    error: 'Naziv datoteke ili direktorija ne smije sadržavati znak / ili \\',
  })
  .refine((value) => value !== '.' && value !== '..', {
    error: 'Naziv datoteke ili direktorija ne smije biti . ili ..',
  })
  .refine((value) => !hasControlCharacters(value), {
    error: 'Naziv datoteke ili direktorija ne smije sadržavati kontrolne znakove',
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
