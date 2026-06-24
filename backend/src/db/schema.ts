import {
  pgTable,
  index,
  unique,
  check,
  bigint,
  uuid,
  text,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const uploadIntentStatus = pgEnum('upload_intent_status', [
  'pending',
  'completed',
  'expired',
]);

export const uploadIntents = pgTable(
  'upload_intents',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    uploadId: uuid('upload_id').notNull(),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: uploadIntentStatus('status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('upload_intents_status_expires_at_idx').on(table.status, table.expiresAt),
    unique('upload_intents_upload_id_key').on(table.uploadId),
    unique('upload_intents_object_key_key').on(table.objectKey),
    check('upload_intents_size_bytes_positive', sql`${table.sizeBytes} > 0`),
    check('upload_intents_expires_after_created', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
