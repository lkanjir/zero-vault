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
    createdByUserId: bigint('created_by_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadId: uuid('upload_id').notNull(),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: uploadIntentStatus('status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    expectedSha256: text('expected_sha256').notNull(),
    actualSha256: text('actual_sha256'),
    checksumVerifiedAt: timestamp('checksum_verified_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('upload_intents_status_expires_at_idx').on(table.status, table.expiresAt),
    index('upload_intents_created_by_user_id_idx').on(table.createdByUserId),
    unique('upload_intents_upload_id_key').on(table.uploadId),
    unique('upload_intents_object_key_key').on(table.objectKey),
    check('upload_intents_expected_sha256_check', sql`${table.expectedSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'upload_intents_actual_sha256_check',
      sql`${table.actualSha256} is null or ${table.actualSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check('upload_intents_size_bytes_positive', sql`${table.sizeBytes} > 0`),
    check('upload_intents_expires_after_created', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    username: text('username'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [unique('users_issuer_subject_key').on(table.issuer, table.subject)],
);
