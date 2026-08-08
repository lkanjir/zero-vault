import * as z from 'zod';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';

const SINGLE_PART_MAX_BYTES = 50 * 1024 * 1024;
const sha256Schema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/);

export const contentTypeSchema = z
  .string()
  .trim()
  .max(500)
  .transform(normalizedContentType)
  .pipe(z.string().min(1).max(500));

const uploadContentSchema = z.object({
  contentType: contentTypeSchema,
  size: z.number().int().positive().max(SINGLE_PART_MAX_BYTES),
  sha256: sha256Schema,
});

export const uploadRequestSchema = uploadContentSchema.extend({
  parentFolderId: z.uuid().nullable().optional(),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !/[\\/]+/.test(value), {
      error: 'Naziv datoteke ne smije sadržavati znak / ili \\',
    }),
});

export type UploadRequestBody = z.output<typeof uploadRequestSchema>;

export const completeUploadSchema = z.object({
  uploadId: z.uuid(),
});

export const replacementUploadRequestSchema = uploadContentSchema;

export type ReplacementUploadRequestBody = z.output<typeof replacementUploadRequestSchema>;
