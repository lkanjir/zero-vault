import * as z from 'zod';

export const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(2000),
  contentType: z.string().min(1).max(255),
  size: z.coerce.number().int().positive(),
});

export type UploadRequestBody = z.output<typeof uploadRequestSchema>;
