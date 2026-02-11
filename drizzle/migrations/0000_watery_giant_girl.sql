CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"is_active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "app_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"build_number" integer DEFAULT 1 NOT NULL,
	"git_commit" text,
	"commit_message" text,
	"lines_added" integer,
	"lines_deleted" integer,
	"files_changed" integer,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deployment_status" text DEFAULT 'pending',
	"vercel_deployment_id" text,
	"vercel_deployment_url" text,
	"deployment_error" text
);
--> statement-breakpoint
CREATE INDEX "idx_app_version_vercel_deployment_id" ON "app_version" USING btree ("vercel_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_app_version_git_commit" ON "app_version" USING btree ("git_commit");--> statement-breakpoint
CREATE INDEX "idx_app_version_build_number" ON "app_version" USING btree ("build_number");