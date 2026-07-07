import * as z from 'zod';

const SINGLE_PART_MAX_BYTES = 50 * 1024 * 1024;
const sha256Schema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/);

export const uploadRequestSchema = z.object({
  parentFolderId: z.uuid().nullable().optional(),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !/[\\/]+/.test(value), {
      message: 'File name must not contain path separators',
    }),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(SINGLE_PART_MAX_BYTES),
  sha256: sha256Schema,
});

export type UploadRequestBody = z.output<typeof uploadRequestSchema>;

export const completeUploadSchema = z.object({
  uploadId: z.uuid(),
});
