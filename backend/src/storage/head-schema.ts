import * as z from 'zod';

export const headSchema = z.object({
  ContentLength: z.number().int().nonnegative(),
  ContentType: z.string().min(1),
  ETag: z.string().min(1).optional(),
});
