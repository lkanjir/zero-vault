import * as z from 'zod';

export const uploadRequestSchema = z.object({
  fileName: z
    .string()
    .min(1)
    .max(2000)
    .refine((f) => f.replaceAll(/[\\/]+/g, '-'))
    .trim(),
  contentType: z.string().min(1).max(255),
  size: z.number().int().positive(),
});

export type UploadRequestBody = z.output<typeof uploadRequestSchema>;

export const completeUploadSchema = z.object({
  uploadId: z.uuid(),
});
