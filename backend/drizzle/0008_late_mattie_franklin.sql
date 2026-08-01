ALTER TABLE "file_grants" DROP CONSTRAINT "file_grants_file_recipient_key";--> statement-breakpoint
ALTER TABLE "file_grants" ALTER COLUMN "recipient_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file_grants" ADD COLUMN "recipient_email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "file_grants" ADD COLUMN "activation_deadline" timestamp;--> statement-breakpoint
CREATE INDEX "file_grants_pending_email_idx" ON "file_grants" USING btree ("recipient_email") WHERE "file_grants"."recipient_user_id" is null;--> statement-breakpoint
CREATE INDEX "file_grants_pending_deadline_idx" ON "file_grants" USING btree ("activation_deadline") WHERE "file_grants"."recipient_user_id" is null;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_file_recipient_email_key" UNIQUE("file_id","recipient_email");--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_recipient_email_normalized_check" CHECK (
      "file_grants"."recipient_email" = lower(btrim("file_grants"."recipient_email"))
      and char_length("file_grants"."recipient_email") between 3 and 254
    );--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_state_check" CHECK (
      (
        "file_grants"."recipient_user_id" is null
        and "file_grants"."activation_deadline" is not null
      )
      or
      (
        "file_grants"."recipient_user_id" is not null
        and "file_grants"."activation_deadline" is null
      )
    );--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_activation_after_creation_check" CHECK (
      "file_grants"."activation_deadline" is null
      or "file_grants"."activation_deadline" > "file_grants"."created_at"
    );--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_activation_before_expiry_check" CHECK (
      "file_grants"."activation_deadline" is null
      or "file_grants"."expires_at" is null
      or "file_grants"."activation_deadline" <= "file_grants"."expires_at"
    );

CREATE UNIQUE INDEX file_grants_file_recipient_user_key
  ON file_grants (recipient_user_id, file_id)
  WHERE recipient_user_id IS NOT NULL;