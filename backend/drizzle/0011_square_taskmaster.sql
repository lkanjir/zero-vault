CREATE TYPE "public"."upload_intent_operation" AS ENUM('create', 'replace');--> statement-breakpoint
ALTER TYPE "public"."upload_intent_status" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TABLE "upload_intents" DROP CONSTRAINT "upload_intents_file_name_length_check";--> statement-breakpoint
ALTER TABLE "upload_intents" ALTER COLUMN "file_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "operation" "upload_intent_operation" DEFAULT 'create' NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "target_file_id" bigint;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "expected_content_version" integer;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_target_file_id_files_entry_id_fk" FOREIGN KEY ("target_file_id") REFERENCES "public"."files"("entry_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_operation_target_check" CHECK (
      (
        "upload_intents"."operation" = 'create'
        and "upload_intents"."file_name" is not null
        and "upload_intents"."target_file_id" is null
        and "upload_intents"."expected_content_version" is null
      ) 
      or 
      (
        "upload_intents"."operation" = 'replace'
        and "upload_intents"."file_name" is null
        and "upload_intents"."target_parent_id" is null
        and "upload_intents"."target_file_id" is not null
        and "upload_intents"."expected_content_version" is not null
        and "upload_intents"."expected_content_version" > 0
      ));--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_file_name_length_check" CHECK (
        "upload_intents"."file_name" is null 
        or char_length(btrim("upload_intents"."file_name")) between 1 and 500);