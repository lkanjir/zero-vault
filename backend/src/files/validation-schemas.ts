import z from 'zod';
import { normalizedEmailSchema } from '../shared/validation/normalized-email-schema.js';

export const fileIdParamsSchema = z.object({ fileId: z.uuid() });
const fileGrantPermissionSchema = z.enum(['viewer', 'editor']);
const fileGrantExpirySchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const cursorPageQuerySchema = z.object({
  cursor: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value) => value ?? null),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const shareFileBodySchema = z.object({
  recipientEmail: normalizedEmailSchema,
  permission: fileGrantPermissionSchema,
  expiresAt: fileGrantExpirySchema.nullable().optional().default(null),
});

export const listFileSharesQuerySchema = cursorPageQuerySchema;
export type ListFileSharesRequest = z.infer<typeof listFileSharesQuerySchema>;

export const fileShareParamsSchema = fileIdParamsSchema.extend({ shareId: z.uuid() });
export const updateFileShareBodySchema = z
  .object({
    permission: fileGrantPermissionSchema.optional(),
    expiresAt: fileGrantExpirySchema.nullable().optional(),
  })
  .refine((body) => body.permission !== undefined || body.expiresAt !== undefined, {
    error: 'Potrebno je definirati barem jedno polje, permission ili expiresAt',
  });
export type UpdateFileShareRequest = z.infer<typeof updateFileShareBodySchema>;

export const listSharedFilesQuerySchema = cursorPageQuerySchema;
export type ListSharedFilesRequest = z.infer<typeof listSharedFilesQuerySchema>;

export const listSharedByMeFilesQuerySchema = cursorPageQuerySchema;
export type ListSharedByMeFilesRequest = z.infer<typeof listSharedByMeFilesQuerySchema>;
