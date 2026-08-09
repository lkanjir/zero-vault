import z from 'zod';
import { AppError } from '../shared/errors/api/app-error.js';

const auditEventListCursorSchema = z.object({
  v: z.literal(1),
  search: z.string().max(500).nullable(),
  occurredAt: z.iso.datetime(),
  auditEventId: z.number().int().positive(),
});

export type AuditEventListCursor = z.infer<typeof auditEventListCursorSchema>;

export function encodeAuditEventListCursor(cursor: AuditEventListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeAuditEventListCursor(value: string): AuditEventListCursor {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf-8');
    const cursor: unknown = JSON.parse(decoded);

    return auditEventListCursorSchema.parse(cursor);
  } catch (error) {
    throw new AppError('invalid_cursor', { cause: error });
  }
}
