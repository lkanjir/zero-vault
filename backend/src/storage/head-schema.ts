import * as z from 'zod';

export const headSchema = z.object({
  objectKey: z.string().nonempty(),
  size: z.number().int().positive(),
  contentType: z.string().nonempty(),
  etag: z.string().nonempty().optional(),
});

export type ObjectMetadata = z.output<typeof headSchema>;
