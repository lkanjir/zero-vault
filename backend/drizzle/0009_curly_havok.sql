ALTER TABLE "file_grants" DROP CONSTRAINT "file_grants_recipient_not_owner_check";--> statement-breakpoint
DROP INDEX "file_grants_recipient_file_idx";--> statement-breakpoint
ALTER TABLE "file_grants" ALTER COLUMN "activation_deadline" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_recipient_not_owner_check" CHECK ("file_grants"."recipient_user_id" is null or "file_grants"."created_by_user_id" <> "file_grants"."recipient_user_id");