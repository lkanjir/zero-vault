CREATE TYPE "public"."entry_kind" AS ENUM('file', 'folder');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('available', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."upload_intent_status" AS ENUM('pending', 'completed', 'expired', 'rejected');--> statement-breakpoint
CREATE TABLE "entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" bigint NOT NULL,
	"parent_id" bigint,
	"kind" "entry_kind" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entries_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "entries_id_owner_id_key" UNIQUE("id","owner_id"),
	CONSTRAINT "entries_not_own_parent_check" CHECK ("entries"."parent_id" is null or "entries"."parent_id" <> "entries"."id"),
	CONSTRAINT "entries_name_not_blank_check" CHECK (char_length(btrim("entries"."name")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"entry_id" bigint PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" "file_status" DEFAULT 'available' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone,
	CONSTRAINT "files_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "files_object_key_not_blank_check" CHECK (char_length(btrim("files"."object_key")) > 0),
	CONSTRAINT "files_content_type_check" CHECK (char_length(btrim("files"."content_type")) between 1 and 500),
	CONSTRAINT "files_size_check" CHECK ("files"."size_bytes" > 0),
	CONSTRAINT "files_sha256_check" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_available_state_check" CHECK (
      (
        "files"."status" = 'available' 
        and "files"."available_at" is not null
      ) 
        or 
      (
        "files"."status" <> 'available' 
        and "files"."available_at" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upload_intents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"upload_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"file_id" bigint,
	"created_by_user_id" bigint NOT NULL,
	"target_parent_id" bigint,
	"file_name" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"expected_size_bytes" bigint NOT NULL,
	"expected_sha256" text NOT NULL,
	"status" "upload_intent_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"upload_url_expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"finalize_deadline" timestamp with time zone NOT NULL,
	CONSTRAINT "upload_intents_upload_id_key" UNIQUE("upload_id"),
	CONSTRAINT "upload_intents_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "upload_intents_file_name_length_check" CHECK (char_length(btrim("upload_intents"."file_name")) between 1 and 500),
	CONSTRAINT "upload_intents_object_key_not_blank_check" CHECK (char_length(btrim("upload_intents"."object_key")) > 0),
	CONSTRAINT "upload_intents_content_type_check" CHECK (char_length(btrim("upload_intents"."content_type")) between 1 and 500),
	CONSTRAINT "upload_intents_size_check" CHECK ("upload_intents"."expected_size_bytes" > 0),
	CONSTRAINT "upload_intents_sha256_check" CHECK ("upload_intents"."expected_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_intents_upload_url_deadline_check" CHECK ("upload_intents"."upload_url_expires_at" > "upload_intents"."created_at"),
	CONSTRAINT "upload_intents_finalize_deadline_check" CHECK ("upload_intents"."finalize_deadline" > "upload_intents"."upload_url_expires_at"),
	CONSTRAINT "upload_intents_completion_state_check" CHECK (
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
    )
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_issuer_subject_key" UNIQUE("issuer","subject"),
	CONSTRAINT "users_public_id_key" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_parent_owner_fk" FOREIGN KEY ("parent_id","owner_id") REFERENCES "public"."entries"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_file_id_files_entry_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("entry_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_target_parent_owner_fk" FOREIGN KEY ("target_parent_id","created_by_user_id") REFERENCES "public"."entries"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_owner_parent_listing_index" ON "entries" USING btree ("owner_id","parent_id",(case when "kind" = 'folder' then 0 else 1 end),lower("name"),"id") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "files_status_changed_at_idx" ON "files" USING btree ("status","status_changed_at");--> statement-breakpoint
CREATE INDEX "upload_intents_user_id_upload_id_idx" ON "upload_intents" USING btree ("created_by_user_id","upload_id");--> statement-breakpoint
CREATE INDEX "upload_intents_pending_finalize_deadline_idx" ON "upload_intents" USING btree ("finalize_deadline") WHERE "upload_intents"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "upload_intents_file_id_idx" ON "upload_intents" USING btree ("file_id") WHERE "upload_intents"."file_id" is not null;