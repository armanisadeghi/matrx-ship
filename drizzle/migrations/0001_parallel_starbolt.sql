CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"request_id" text,
	"trace_id" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_logs_source_timestamp" ON "logs" USING btree ("source","timestamp");--> statement-breakpoint
CREATE INDEX "idx_logs_level_timestamp" ON "logs" USING btree ("level","timestamp");--> statement-breakpoint
CREATE INDEX "idx_logs_timestamp" ON "logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_logs_environment" ON "logs" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "idx_logs_request_id" ON "logs" USING btree ("request_id");