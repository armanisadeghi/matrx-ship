CREATE TABLE "ticket_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"author_type" text NOT NULL,
	"author_name" text,
	"content" text,
	"metadata" jsonb,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" serial NOT NULL,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"ticket_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"resolution" text,
	"priority" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"route" text,
	"environment" text,
	"browser_info" text,
	"os_info" text,
	"reporter_id" text NOT NULL,
	"reporter_name" text,
	"reporter_email" text,
	"assignee" text,
	"direction" text,
	"ai_assessment" text,
	"ai_solution_proposal" text,
	"ai_suggested_priority" text,
	"ai_complexity" text,
	"ai_estimated_files" text[],
	"autonomy_score" integer,
	"work_priority" integer,
	"testing_result" text,
	"needs_followup" boolean DEFAULT false NOT NULL,
	"followup_notes" text,
	"followup_after" timestamp with time zone,
	"parent_id" uuid,
	"client_reference_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_timeline" ON "ticket_activity" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_type" ON "ticket_activity" USING btree ("ticket_id","activity_type");--> statement-breakpoint
CREATE INDEX "idx_activity_user_visible" ON "ticket_activity" USING btree ("ticket_id","visibility","created_at");--> statement-breakpoint
CREATE INDEX "idx_attachments_ticket" ON "ticket_attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_project_status" ON "tickets" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_tickets_project_status_created" ON "tickets" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_reporter" ON "tickets" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_number" ON "tickets" USING btree ("ticket_number");--> statement-breakpoint
CREATE INDEX "idx_tickets_work_priority" ON "tickets" USING btree ("work_priority");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tickets_idempotent" ON "tickets" USING btree ("project_id","client_reference_id") WHERE "tickets"."client_reference_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tickets_followup" ON "tickets" USING btree ("needs_followup","followup_after") WHERE "tickets"."needs_followup" = true;--> statement-breakpoint
CREATE INDEX "idx_tickets_parent" ON "tickets" USING btree ("parent_id");--> statement-breakpoint
CREATE VIEW "public"."vw_ticket_timeline" AS (select "tickets"."id" as "ticket_id", "tickets"."ticket_number" as "ticket_number", "tickets"."title" as "ticket_title", "tickets"."status" as "current_status", "tickets"."resolution" as "current_resolution", "ticket_activity"."id" as "activity_id", "ticket_activity"."activity_type", "ticket_activity"."author_type", "ticket_activity"."author_name", "ticket_activity"."content", "ticket_activity"."metadata", "ticket_activity"."visibility", "ticket_activity"."requires_approval", "ticket_activity"."approved_by", "ticket_activity"."approved_at", "ticket_activity"."created_at" from "tickets" inner join "ticket_activity" on "ticket_activity"."ticket_id" = "tickets"."id" where "tickets"."deleted_at" IS NULL order by "tickets"."id", "ticket_activity"."created_at");