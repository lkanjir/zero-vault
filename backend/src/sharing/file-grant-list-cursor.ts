import z from 'zod';
import { normalizedEmailSchema } from '../shared/validation/normalized-email-schema.js';
import { AppError } from '../shared/errors/api/app-error.js';

const fileGrantListCursorSchema = z.object({
  v: z.literal(1),
  filePublicId: z.uuid(),
  recipientEmail: normalizedEmailSchema,
  grantDbId: z.number().int().positive(),
});

export type FileGrantListCursor = z.infer<typeof fileGrantListCursorSchema>;

export function encodeFileGrantListCursor(cursor: FileGrantListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeFileGrantListCursor(value: string): FileGrantListCursor {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf-8');
    const cursor: unknown = JSON.parse(decoded);

    return fileGrantListCursorSchema.parse(cursor);
  } catch (error) {
    throw new AppError('invalid_cursor', { cause: error, context: { cursorLength: value.length } });
  }
}
