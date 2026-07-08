import z from 'zod';

export const fileIdParamsSchema = z.object({
  fileId: z.uuid(),
});
