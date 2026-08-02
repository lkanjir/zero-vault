import z from 'zod';
import { AppError } from '../shared/errors/api/app-error.js';

const sharedFileListCursorSchema = z.object({
  v: z.literal(1),
  sortName: z.string().min(1).max(500),
  entryId: z.number().int().positive(),
});
export type SharedFileListCursor = z.infer<typeof sharedFileListCursorSchema>;

export function encodeSharedFileListCursor(cursor: SharedFileListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeSharedFileListCursor(value: string): SharedFileListCursor {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf-8');

    const cursor: unknown = JSON.parse(decoded);
    return sharedFileListCursorSchema.parse(cursor);
  } catch (error) {
    throw new AppError('invalid_cursor', {
      cause: error,
      context: {
        cursorLength: value.length,
      },
    });
  }
}
