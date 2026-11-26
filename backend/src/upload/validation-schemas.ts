import * as z from 'zod';
import { entryNameSchema } from '../entry/validation-schemas.js';
import { normalizedContentType } from '../shared/utils/normalize-content-type.js';
import {
  MAX_MULTIPART_PARTS,
  MAX_PRESIGN_PARTS_BATCH,
  MAX_UPLOAD_SIZE_BYTES,
  SINGLE_PART_MAX_BYTES,
} from './upload-sizing.js';

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

function validateUploadChecksumRequirement(
  value: { size: number; sha256?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.size <= SINGLE_PART_MAX_BYTES && value.sha256 === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['sha256'],
      message: 'Kontrolni zbroj (SHA-256) je obavezan za datoteke do 16 MiB.',
    });
  }

  if (value.size > SINGLE_PART_MAX_BYTES && value.sha256 !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['sha256'],
      message: 'Kontrolni zbroj cijele datoteke nije podržan za višedijelni prijenos.',
    });
  }
}

function validateUniquePartNumbers(
  parts: readonly { partNumber: number }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<number>();

  for (let index = 0; index < parts.length; index++) {
    const partNumber = parts[index]!.partNumber;
    if (seen.has(partNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['parts', index, 'partNumber'],
        message: 'Brojevi dijelova moraju biti jedinstveni.',
      });
    }
    seen.add(partNumber);
  }
}

const uploadContentBaseSchema = z.object({
  contentType: contentTypeSchema,
  size: z.number().int().nonnegative().max(MAX_UPLOAD_SIZE_BYTES),
  sha256: sha256Schema.optional(),
});

export const uploadRequestSchema = uploadContentBaseSchema
  .extend({
    parentFolderId: z.uuid().nullable().optional(),
    fileName: entryNameSchema,
  })
  .superRefine(validateUploadChecksumRequirement);

export type UploadRequestBody = z.output<typeof uploadRequestSchema>;

export const replacementUploadRequestSchema = uploadContentBaseSchema.superRefine(
  validateUploadChecksumRequirement,
);

export type ReplacementUploadRequestBody = z.output<typeof replacementUploadRequestSchema>;

export const uploadIdParamsSchema = z.object({
  uploadId: z.uuid(),
});

export const presignPartsBodySchema = z
  .object({
    parts: z
      .array(
        z.object({
          partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
          sha256: sha256Schema,
        }),
      )
      .min(1)
      .max(MAX_PRESIGN_PARTS_BATCH),
  })
  .superRefine((value, ctx) => validateUniquePartNumbers(value.parts, ctx));

export type PresignPartsRequestBody = z.output<typeof presignPartsBodySchema>;

const completeUploadPartSchema = z.object({
  partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
  etag: z.string().trim().min(1).max(200),
  sha256: sha256Schema,
});

export const completeUploadBodySchema = z
  .union([
    z.undefined(),
    z.null(),
    z
      .object({
        parts: z.array(completeUploadPartSchema).min(2).max(MAX_MULTIPART_PARTS).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.parts !== undefined) {
          validateUniquePartNumbers(value.parts, ctx);
        }
      }),
  ])
  .transform((value) => ({
    parts: value?.parts,
  }));

export type CompleteUploadRequestBody = z.output<typeof completeUploadBodySchema>;
