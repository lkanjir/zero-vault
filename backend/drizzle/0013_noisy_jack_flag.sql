CREATE TYPE "public"."audit_action" AS ENUM('folder.created', 'file.uploaded', 'entry.renamed', 'entry.moved', 'entry.deleted', 'file.content_replaced', 'file.download_url_issued', 'folder.archive_requested', 'file.share_submitted', 'file.share_updated', 'file.share_revoked');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" bigint NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"entry_id" bigint NOT NULL,
	"entry_name_snapshot" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "audit_events_entry_name_snapshot_not_blank_check" CHECK (char_length(btrim("audit_events"."entry_name_snapshot")) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_entry_owner_fk" FOREIGN KEY ("entry_id","owner_id") REFERENCES "public"."entries"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_owner_occurred_at_id_idx" ON "audit_events" USING btree ("owner_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_entry_occurred_at_id_idx" ON "audit_events" USING btree ("entry_id","occurred_at","id");