import * as z from 'zod';

export const headSchema = z.object({
  ContentLength: z.number().int().nonnegative(),
  ContentType: z.string().min(1),
  ChecksumSHA256: z.string().trim().min(1).optional(),
});
