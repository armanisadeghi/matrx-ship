CREATE TABLE "infra_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"instance_name" text,
	"backup_type" text NOT NULL,
	"s3_key" text NOT NULL,
	"size_bytes" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"git_commit" text,
	"git_branch" text,
	"git_message" text,
	"image_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"duration_ms" integer,
	"triggered_by" text DEFAULT 'unknown' NOT NULL,
	"instances_restarted" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "infra_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"subdomain" text NOT NULL,
	"image" text DEFAULT 'matrx-ship:latest' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"api_key" text,
	"admin_secret" text,
	"postgres_password" text,
	"postgres_image" text DEFAULT 'postgres:17-alpine',
	"env_vars" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostname" text NOT NULL,
	"ip" text NOT NULL,
	"domain_suffix" text NOT NULL,
	"ssh_port" integer DEFAULT 22 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_heartbeat" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "managed_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"template" text,
	"status" text DEFAULT 'active' NOT NULL,
	"size_bytes" integer,
	"table_count" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infra_audit_log" ADD CONSTRAINT "infra_audit_log_server_id_infra_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."infra_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_backups" ADD CONSTRAINT "infra_backups_server_id_infra_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."infra_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_builds" ADD CONSTRAINT "infra_builds_server_id_infra_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."infra_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_instances" ADD CONSTRAINT "infra_instances_server_id_infra_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."infra_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_tokens" ADD CONSTRAINT "infra_tokens_server_id_infra_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."infra_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_infra_audit_server" ON "infra_audit_log" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_infra_audit_action" ON "infra_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_infra_audit_created" ON "infra_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_infra_audit_target" ON "infra_audit_log" USING btree ("target");--> statement-breakpoint
CREATE INDEX "idx_infra_backups_server" ON "infra_backups" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_infra_backups_instance" ON "infra_backups" USING btree ("instance_name");--> statement-breakpoint
CREATE INDEX "idx_infra_backups_type" ON "infra_backups" USING btree ("backup_type");--> statement-breakpoint
CREATE INDEX "idx_infra_builds_server" ON "infra_builds" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_infra_builds_started" ON "infra_builds" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_infra_builds_tag" ON "infra_builds" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_infra_instances_server_name" ON "infra_instances" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "idx_infra_instances_server" ON "infra_instances" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_infra_tokens_server" ON "infra_tokens" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_infra_tokens_hash" ON "infra_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_managed_databases_name" ON "managed_databases" USING btree ("database_name");--> statement-breakpoint
CREATE INDEX "idx_managed_databases_status" ON "managed_databases" USING btree ("status");