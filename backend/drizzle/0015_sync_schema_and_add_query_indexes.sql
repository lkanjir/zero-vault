CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "audit_events_entry_name_snapshot_trgm_idx" ON "audit_events" USING gin ("entry_name_snapshot" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "entries_owner_parent_updated_at_listing_idx" ON "entries" USING btree ("owner_id","parent_id",(case when "kind" = 'folder' then 0 else 1 end),date_trunc('milliseconds', "updated_at", 'UTC'),"id") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "entries_name_trgm_idx" ON "entries" USING gin ("name" gin_trgm_ops) WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_grants_file_recipient_user_key" ON "file_grants" USING btree ("recipient_user_id","file_id") WHERE "file_grants"."recipient_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_active_email_key" ON "users" USING btree (lower("email")) WHERE "users"."deleted_at" is null;