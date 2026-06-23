import { pgTable, index, unique, check, bigint, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const uploadIntentStatus = pgEnum("upload_intent_status", ['pending', 'completed', 'expired'])


export const uploadIntents = pgTable("upload_intents", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "upload_intents_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	uploadId: uuid("upload_id").notNull(),
	objectKey: text("object_key").notNull(),
	fileName: text("file_name").notNull(),
	contentType: text("content_type").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
	status: uploadIntentStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("upload_intents_status_expires_at_idx").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.expiresAt.asc().nullsLast().op("enum_ops")),
	unique("upload_intents_upload_id_key").on(table.uploadId),
	unique("upload_intents_object_key_key").on(table.objectKey),
	check("upload_intents_size_bytes_positive", sql`size_bytes > 0`),
	check("upload_intents_expires_after_created", sql`expires_at > created_at`),
	check("upload_intents_completed_at_status_check", sql`((status = 'completed'::upload_intent_status) AND (completed_at IS NOT NULL)) OR ((status <> 'completed'::upload_intent_status) AND (completed_at IS NULL))`),
]);
