import z from 'zod';
import { entryNameSchema } from '../entry/validation-schemas.js';

export const createFolderBodySchema = z.object({
  parentId: z
    .uuid()
    .optional()
    .transform((val) => val ?? null),
  name: entryNameSchema,
});

export type CreateFolderRequestBody = z.infer<typeof createFolderBodySchema>;
