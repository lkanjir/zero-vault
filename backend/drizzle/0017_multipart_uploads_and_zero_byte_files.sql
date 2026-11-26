CREATE TYPE "public"."checksum_type" AS ENUM('full_sha256', 'composite_sha256');--> statement-breakpoint
CREATE TYPE "public"."upload_mode" AS ENUM('single', 'multipart');--> statement-breakpoint
ALTER TYPE "public"."object_deletion_reason" ADD VALUE 'aborted_upload';--> statement-breakpoint
ALTER TYPE "public"."upload_intent_status" ADD VALUE 'aborted';--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_size_check";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_sha256_check";--> statement-breakpoint
ALTER TABLE "upload_intents" DROP CONSTRAINT "upload_intents_size_check";--> statement-breakpoint
ALTER TABLE "upload_intents" DROP CONSTRAINT "upload_intents_sha256_check";--> statement-breakpoint
ALTER TABLE "upload_intents" DROP CONSTRAINT "upload_intents_upload_url_deadline_check";--> statement-breakpoint
ALTER TABLE "upload_intents" DROP CONSTRAINT "upload_intents_finalize_deadline_check";--> statement-breakpoint
ALTER TABLE "upload_intents" ALTER COLUMN "expected_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_intents" ALTER COLUMN "upload_url_expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "checksum_type" "checksum_type" DEFAULT 'full_sha256' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_deletion_jobs" ADD COLUMN "s3_upload_id" text;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "upload_mode" "upload_mode" DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "s3_upload_id" text;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "part_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "part_count" integer;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "checksum_type" "checksum_type" DEFAULT 'full_sha256' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_size_check" CHECK ("files"."size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_sha256_check" CHECK (
      (
        "files"."checksum_type" = 'full_sha256'
        and "files"."sha256" ~ '^[0-9a-f]{64}$'
      )
      or
      (
        "files"."checksum_type" = 'composite_sha256'
        and "files"."sha256" ~ '^[A-Za-z0-9+/]{43}=-[1-9][0-9]*$'
      )
    );--> statement-breakpoint
ALTER TABLE "object_deletion_jobs" ADD CONSTRAINT "object_deletion_jobs_s3_upload_id_not_blank_check" CHECK ("object_deletion_jobs"."s3_upload_id" is null or char_length(btrim("object_deletion_jobs"."s3_upload_id")) > 0);--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_mode_check" CHECK (
      (
        "upload_intents"."upload_mode" = 'single'
        and "upload_intents"."checksum_type" = 'full_sha256'
        and "upload_intents"."expected_sha256" is not null
        and "upload_intents"."upload_url_expires_at" is not null
        and "upload_intents"."s3_upload_id" is null
        and "upload_intents"."part_size_bytes" is null
        and "upload_intents"."part_count" is null
      )
      or
      (
        "upload_intents"."upload_mode" = 'multipart'
        and "upload_intents"."checksum_type" = 'composite_sha256'
        and "upload_intents"."expected_sha256" is null
        and "upload_intents"."upload_url_expires_at" is null
        and "upload_intents"."s3_upload_id" is not null
        and char_length(btrim("upload_intents"."s3_upload_id")) > 0
        and "upload_intents"."part_size_bytes" is not null
        and "upload_intents"."part_size_bytes" > 0
        and "upload_intents"."part_count" is not null
        and "upload_intents"."part_count" between 2 and 10000
      )
    );--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_size_check" CHECK ("upload_intents"."expected_size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_sha256_check" CHECK ("upload_intents"."expected_sha256" is null or "upload_intents"."expected_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_upload_url_deadline_check" CHECK ("upload_intents"."upload_url_expires_at" is null or "upload_intents"."upload_url_expires_at" > "upload_intents"."created_at");--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_finalize_deadline_check" CHECK ("upload_intents"."finalize_deadline" > "upload_intents"."created_at" and ("upload_intents"."upload_url_expires_at" is null or "upload_intents"."finalize_deadline" > "upload_intents"."upload_url_expires_at"));