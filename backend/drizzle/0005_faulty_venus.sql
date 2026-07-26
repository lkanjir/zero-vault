CREATE TYPE "public"."object_deletion_reason" AS ENUM('expired_upload', 'deleted_file', 'expired_folder_archive', 'stale_folder_archive_attempt');--> statement-breakpoint
CREATE TABLE "object_deletion_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "object_deletion_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"object_key" text NOT NULL,
	"reason" "object_deletion_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "object_deletion_jobs_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "object_deletion_jobs_object_key_not_blank_check" CHECK (char_length(btrim("object_deletion_jobs"."object_key")) > 0),
	CONSTRAINT "object_deletion_jobs_attempt_count_check" CHECK ("object_deletion_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "object_deletion_jobs_claim_idx" ON "object_deletion_jobs" USING btree ("available_at","id") WHERE "object_deletion_jobs"."completed_at" is null;