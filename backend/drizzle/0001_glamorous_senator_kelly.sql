ALTER TABLE "upload_intents" ADD COLUMN "expected_sha256" text NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "actual_sha256" text;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "checksum_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_expected_sha256_check" CHECK ("upload_intents"."expected_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_actual_sha256_check" CHECK ("upload_intents"."actual_sha256" is null or "upload_intents"."actual_sha256" ~ '^[0-9a-f]{64}$');