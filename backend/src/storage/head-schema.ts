import * as z from 'zod';

const sha256Base64Schema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9+/]{43}=$/);

export const headSchema = z.object({
  ContentLength: z.number().int().nonnegative(),
  ContentType: z.string().trim().min(1),
  ChecksumSHA256: sha256Base64Schema.optional(),
});
