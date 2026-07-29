CREATE TYPE "public"."file_grant_permission" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TABLE "file_grants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "file_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"file_id" bigint NOT NULL,
	"recipient_user_id" bigint NOT NULL,
	"created_by_user_id" bigint NOT NULL,
	"permission" "file_grant_permission" NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_grants_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "file_grants_file_recipient_key" UNIQUE("file_id","recipient_user_id"),
	CONSTRAINT "file_grants_recipient_not_owner_check" CHECK ("file_grants"."created_by_user_id" <> "file_grants"."recipient_user_id"),
	CONSTRAINT "file_grants_expiry_after_creation_check" CHECK ("file_grants"."expires_at" is null or "file_grants"."expires_at" > "file_grants"."created_at")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_file_id_files_entry_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("entry_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_file_owner_fk" FOREIGN KEY ("file_id","created_by_user_id") REFERENCES "public"."entries"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_grants_recipient_file_idx" ON "file_grants" USING btree ("recipient_user_id","file_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_content_version_check" CHECK ("files"."content_version" > 0);