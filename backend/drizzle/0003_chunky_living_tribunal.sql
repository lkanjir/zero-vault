ALTER TABLE "files" DROP CONSTRAINT "files_available_state_check";--> statement-breakpoint
ALTER TABLE "upload_intents" DROP CONSTRAINT "upload_intents_completion_state_check";--> statement-breakpoint
DROP INDEX "upload_intents_pending_finalize_deadline_idx";--> statement-breakpoint
ALTER TABLE "upload_intents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "upload_intents" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
DROP TYPE "public"."upload_intent_status";--> statement-breakpoint
CREATE TYPE "public"."upload_intent_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
ALTER TABLE "upload_intents" ALTER COLUMN "status" SET DATA TYPE "public"."upload_intent_status" USING "status"::"public"."upload_intent_status";--> statement-breakpoint
ALTER TABLE "upload_intents" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."upload_intent_status";--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_completion_state_check" CHECK (
      (
        "upload_intents"."status" = 'completed'
        and "upload_intents"."file_id" is not null
        and "upload_intents"."completed_at" is not null
      )
      or
      (
        "upload_intents"."status" <> 'completed'
        and "upload_intents"."file_id" is null
        and "upload_intents"."completed_at" is null
      )
    );--> statement-breakpoint
CREATE INDEX "upload_intents_pending_finalize_deadline_idx" ON "upload_intents" USING btree ("finalize_deadline") WHERE "upload_intents"."status" = 'pending';--> statement-breakpoint
DROP INDEX "files_status_changed_at_idx";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN "status_changed_at";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN "available_at";--> statement-breakpoint
DROP TYPE "public"."file_status";
