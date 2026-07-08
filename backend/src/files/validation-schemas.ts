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

const entryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\\/]+/.test(value), {
    message: 'Folder name must not contain path separators',
  });

export const createFolderBodySchema = z.object({
  parentId: z
    .uuid()
    .optional()
    .transform((val) => val ?? null),
  name: entryNameSchema,
});

export type CreateFolderRequestBody = z.infer<typeof createFolderBodySchema>;
