import z from 'zod';
import { AppError } from '../shared/errors/api/app-error.js';

const entryListCursorSchema = z.object({
  v: z.literal(1),
  parentId: z.uuid().nullable(),
  kindRank: z.union([z.literal(0), z.literal(1)]), // 0 - folder, 1 - file --- folder prije file
  sortName: z.string().min(1).max(500),
  entryId: z.number().int().positive(),
});

export type EntryListCursor = z.infer<typeof entryListCursorSchema>;

export function encodeCursor(cursor: EntryListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeCursor(value: string): EntryListCursor {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf-8');
    const cursor: unknown = JSON.parse(decoded);

    return entryListCursorSchema.parse(cursor);
  } catch {
    throw new AppError('invalid_cursor', {
      context: {
        cursorLength: value.length,
      },
    });
  }
}
