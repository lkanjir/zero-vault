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
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const uploadIntentStatus = pgEnum('upload_intent_status', [
  'pending',
  'completed',
  'expired',
  'rejected',
]);

export const entryKind = pgEnum('entry_kind', ['file', 'folder']);

export const fileStatus = pgEnum('file_status', ['available', 'rejected']);

export const uploadIntents = pgTable(
  'upload_intents',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    uploadId: uuid('upload_id').defaultRandom().notNull(),
    fileId: bigint('file_id', { mode: 'number' }).references(() => files.entryId, {
      onDelete: 'restrict',
    }),
    createdByUserId: bigint('created_by_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    targetParentId: bigint('target_parent_id', { mode: 'number' }),
    fileName: text('file_name').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    expectedSizeBytes: bigint('expected_size_bytes', { mode: 'number' }).notNull(),
    expectedSha256: text('expected_sha256').notNull(),
    status: uploadIntentStatus('status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    uploadUrlExpiresAt: timestamp('upload_url_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    finalizeDeadline: timestamp('finalize_deadline', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
  },
  (table) => [
    unique('upload_intents_upload_id_key').on(table.uploadId),
    unique('upload_intents_object_key_key').on(table.objectKey),
    check(
      'upload_intents_file_name_length_check',
      sql`char_length(btrim(${table.fileName})) between 1 and 500`,
    ),
    check(
      'upload_intents_object_key_not_blank_check',
      sql`char_length(btrim(${table.objectKey})) > 0`,
    ),
    check(
      'upload_intents_content_type_check',
      sql`char_length(btrim(${table.contentType})) between 1 and 500`,
    ),
    check('upload_intents_size_check', sql`${table.expectedSizeBytes} > 0`),
    check('upload_intents_sha256_check', sql`${table.expectedSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'upload_intents_upload_url_deadline_check',
      sql`${table.uploadUrlExpiresAt} > ${table.createdAt}`,
    ),
    check(
      'upload_intents_finalize_deadline_check',
      sql`${table.finalizeDeadline} > ${table.uploadUrlExpiresAt}`,
    ),
    check(
      'upload_intents_completion_state_check',
      sql`
      (
        ${table.status} = 'completed'
        and ${table.fileId} is not null
        and ${table.completedAt} is not null
      )
      or
      (
        ${table.status} <> 'completed'
        and ${table.fileId} is null
        and ${table.completedAt} is null
      )
    `,
    ),
    index('upload_intents_user_id_upload_id_idx').on(table.createdByUserId, table.uploadId),
    index('upload_intents_pending_finalize_deadline_idx')
      .on(table.finalizeDeadline)
      .where(sql`${table.status} = 'pending'`),
    index('upload_intents_file_id_idx')
      .on(table.fileId)
      .where(sql`${table.fileId} is not null`),
    foreignKey({
      name: 'upload_intents_target_parent_owner_fk',
      columns: [table.targetParentId, table.createdByUserId],
      foreignColumns: [entries.id, entries.ownerId],
    }).onDelete('restrict'),
  ],
);

export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').defaultRandom().notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    username: text('username'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    unique('users_issuer_subject_key').on(table.issuer, table.subject),
    unique('users_public_id_key').on(table.publicId),
  ],
);

export const entries = pgTable(
  'entries',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').defaultRandom().notNull(),
    ownerId: bigint('owner_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    parentId: bigint('parent_id', { mode: 'number' }),
    kind: entryKind('kind').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('entries_public_id_key').on(table.publicId),
    unique('entries_id_owner_id_key').on(table.id, table.ownerId),
    foreignKey({
      name: 'entries_parent_owner_fk',
      columns: [table.parentId, table.ownerId],
      foreignColumns: [table.id, table.ownerId],
    }).onDelete('restrict'),
    check(
      'entries_not_own_parent_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    check('entries_name_not_blank_check', sql`char_length(btrim(${table.name})) between 1 and 500`),
    index('entries_owner_parent_listing_index')
      .on(
        table.ownerId,
        table.parentId,
        sql`(case when ${table.kind} = 'folder' then 0 else 1 end)`,
        sql`lower(${table.name})`,
        table.id,
      )
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const files = pgTable(
  'files',
  {
    entryId: bigint('entry_id', { mode: 'number' })
      .primaryKey()
      .references(() => entries.id, { onDelete: 'restrict' }),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').default('application/octet-stream').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    status: fileStatus('status').notNull(),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('files_object_key_key').on(table.objectKey),
    check('files_object_key_not_blank_check', sql`char_length(btrim(${table.objectKey})) > 0`),
    check(
      'files_content_type_check',
      sql`char_length(btrim(${table.contentType})) between 1 and 500`,
    ),
    check('files_size_check', sql`${table.sizeBytes} > 0`),
    check('files_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'files_available_state_check',
      sql`
      (
        ${table.status} = 'available' 
        and ${table.availableAt} is not null
      ) 
        or 
      (
        ${table.status} <> 'available' 
        and ${table.availableAt} is null
      )`,
    ),
    index('files_status_changed_at_idx').on(table.status, table.statusChangedAt),
  ],
);
