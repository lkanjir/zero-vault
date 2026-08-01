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
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const uploadIntentStatus = pgEnum('upload_intent_status', [
  'pending',
  'completed',
  'expired',
]);

export const entryKind = pgEnum('entry_kind', ['file', 'folder']);

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
    email: text('email').notNull(),
    username: text('username'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('users_issuer_subject_key').on(table.issuer, table.subject),
    unique('users_public_id_key').on(table.publicId),
    check(
      'users_email_normalized_check',
      sql`
      ${table.email} = lower(btrim(${table.email}))
      and char_length(${table.email}) between 3 and 254
    `,
    ),
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
    contentVersion: integer('content_version').default(1).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
  },
  (table) => [
    unique('files_object_key_key').on(table.objectKey),
    check('files_object_key_not_blank_check', sql`char_length(btrim(${table.objectKey})) > 0`),
    check(
      'files_content_type_check',
      sql`char_length(btrim(${table.contentType})) between 1 and 500`,
    ),
    check('files_content_version_check', sql`${table.contentVersion} > 0`),
    check('files_size_check', sql`${table.sizeBytes} > 0`),
    check('files_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const folderDownloadStatus = pgEnum('folder_download_status', [
  'queued',
  'processing',
  'ready',
  'failed',
  'expired',
]);

export const folderDownloads = pgTable(
  'folder_downloads',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    downloadId: uuid('download_id').notNull(),
    ownerId: bigint('owner_id', { mode: 'number' }).notNull(),
    folderId: bigint('folder_id', { mode: 'number' }).notNull(),
    folderName: text('folder_name').notNull(),
    archiveObjectKey: text('archive_object_key').notNull(),
    status: folderDownloadStatus('status').default('queued').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    archiveSizeBytes: bigint('archive_size_bytes', { mode: 'number' }),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('folder_downloads_download_id_key').on(table.downloadId),
    unique('folder_downloads_archive_object_key_key').on(table.archiveObjectKey),
    index('folder_downloads_queued_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'queued'`),
    index('folder_downloads_processing_lease_idx')
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'processing'`),
    index('folder_downloads_ready_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'ready'`),
    foreignKey({
      name: 'folder_downloads_owner_fk',
      columns: [table.ownerId],
      foreignColumns: [users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'folder_downloads_folder_owner_fk',
      columns: [table.folderId, table.ownerId],
      foreignColumns: [entries.id, entries.ownerId],
    }).onDelete('restrict'),
  ],
);

export const objectDeletionReason = pgEnum('object_deletion_reason', [
  'expired_upload',
  'deleted_file',
  'expired_folder_archive',
  'stale_folder_archive_attempt',
]);

export const objectDeletionJobs = pgTable(
  'object_deletion_jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    objectKey: text('object_key').notNull(),
    reason: objectDeletionReason('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    lastErrorCode: text('last_error_code'),
  },
  (table) => [
    unique('object_deletion_jobs_object_key_key').on(table.objectKey),
    check(
      'object_deletion_jobs_object_key_not_blank_check',
      sql`char_length(btrim(${table.objectKey})) > 0`,
    ),
    check('object_deletion_jobs_attempt_count_check', sql`${table.attemptCount} >= 0`),
    index('object_deletion_jobs_claim_idx')
      .on(table.availableAt, table.id)
      .where(sql`${table.completedAt} is null`),
  ],
);

export const fileGrantPermission = pgEnum('file_grant_permission', ['viewer', 'editor']);

export const fileGrants = pgTable(
  'file_grants',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid('public_id').defaultRandom().notNull(),
    fileId: bigint('file_id', { mode: 'number' })
      .notNull()
      .references(() => files.entryId, { onDelete: 'cascade' }),
    recipientUserId: bigint('recipient_user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'cascade',
    }),
    recipientEmail: text('recipient_email').notNull(),
    createdByUserId: bigint('created_by_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    permission: fileGrantPermission('permission').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    activationDeadline: timestamp('activation_deadline', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('file_grants_public_id_key').on(table.publicId),
    unique('file_grants_file_recipient_email_key').on(table.fileId, table.recipientEmail),
    check(
      'file_grants_recipient_not_owner_check',
      sql`${table.recipientUserId} is null or ${table.createdByUserId} <> ${table.recipientUserId}`,
    ),
    check(
      'file_grants_expiry_after_creation_check',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'file_grants_recipient_email_normalized_check',
      sql`
      ${table.recipientEmail} = lower(btrim(${table.recipientEmail}))
      and char_length(${table.recipientEmail}) between 3 and 254
    `,
    ),
    check(
      'file_grants_state_check',
      sql`
      (
        ${table.recipientUserId} is null
        and ${table.activationDeadline} is not null
      )
      or
      (
        ${table.recipientUserId} is not null
        and ${table.activationDeadline} is null
      )
    `,
    ),
    check(
      'file_grants_activation_after_creation_check',
      sql`
      ${table.activationDeadline} is null
      or ${table.activationDeadline} > ${table.createdAt}
    `,
    ),
    check(
      'file_grants_activation_before_expiry_check',
      sql`
      ${table.activationDeadline} is null
      or ${table.expiresAt} is null
      or ${table.activationDeadline} <= ${table.expiresAt}
    `,
    ),
    index('file_grants_pending_email_idx')
      .on(table.recipientEmail)
      .where(sql`${table.recipientUserId} is null`),
    index('file_grants_pending_deadline_idx')
      .on(table.activationDeadline)
      .where(sql`${table.recipientUserId} is null`),
    foreignKey({
      name: 'file_grants_file_owner_fk',
      columns: [table.fileId, table.createdByUserId],
      foreignColumns: [entries.id, entries.ownerId],
    }).onDelete('restrict'),
  ],
);
