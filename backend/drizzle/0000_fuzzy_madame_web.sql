CREATE TYPE "public"."upload_intent_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upload_intents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"upload_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" "upload_intent_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "upload_intents_upload_id_key" UNIQUE("upload_id"),
	CONSTRAINT "upload_intents_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "upload_intents_size_bytes_positive" CHECK ("upload_intents"."size_bytes" > 0),
	CONSTRAINT "upload_intents_expires_after_created" CHECK ("upload_intents"."expires_at" > "upload_intents"."created_at")
);
--> statement-breakpoint
CREATE INDEX "upload_intents_status_expires_at_idx" ON "upload_intents" USING btree ("status","expires_at");