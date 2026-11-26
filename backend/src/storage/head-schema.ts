import * as z from 'zod';

const sha256ChecksumSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9+/]{43}=(-[1-9][0-9]*)?$/);

export const headSchema = z.object({
  ContentLength: z.number().int().nonnegative(),
  ContentType: z.string().trim().min(1),
  ChecksumSHA256: sha256ChecksumSchema.optional(),
  ChecksumType: z.enum(['FULL_OBJECT', 'COMPOSITE']).optional(),
});
