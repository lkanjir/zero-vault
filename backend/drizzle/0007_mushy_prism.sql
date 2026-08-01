ALTER TABLE "users" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_check" CHECK (
      "users"."email" = lower(btrim("users"."email"))
      and char_length("users"."email") between 3 and 254
    );

CREATE UNIQUE INDEX users_active_email_key
  ON users (lower(email))
  WHERE deleted_at IS NULL;