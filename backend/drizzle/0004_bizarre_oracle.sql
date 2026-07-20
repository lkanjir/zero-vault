CREATE TYPE "public"."folder_download_status" AS ENUM('queued', 'processing', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "folder_downloads" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "folder_downloads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"download_id" uuid NOT NULL,
	"owner_id" bigint NOT NULL,
	"folder_id" bigint NOT NULL,
	"folder_name" text NOT NULL,
	"archive_object_key" text NOT NULL,
	"status" "folder_download_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"archive_size_bytes" bigint,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "folder_downloads_download_id_key" UNIQUE("download_id"),
	CONSTRAINT "folder_downloads_archive_object_key_key" UNIQUE("archive_object_key")
);
--> statement-breakpoint
ALTER TABLE "folder_downloads" ADD CONSTRAINT "folder_downloads_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_downloads" ADD CONSTRAINT "folder_downloads_folder_owner_fk" FOREIGN KEY ("folder_id","owner_id") REFERENCES "public"."entries"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_downloads_queued_created_at_idx" ON "folder_downloads" USING btree ("created_at") WHERE "folder_downloads"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "folder_downloads_processing_lease_idx" ON "folder_downloads" USING btree ("lease_expires_at") WHERE "folder_downloads"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "folder_downloads_ready_expires_at_idx" ON "folder_downloads" USING btree ("expires_at") WHERE "folder_downloads"."status" = 'ready';