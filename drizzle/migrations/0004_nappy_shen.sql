CREATE TABLE "custom_mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_name" text NOT NULL,
	"description" text NOT NULL,
	"input_schema" text,
	"sql_template" text NOT NULL,
	"target_database" text DEFAULT 'ship',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_custom_mcp_tools_name" ON "custom_mcp_tools" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "idx_custom_mcp_tools_active" ON "custom_mcp_tools" USING btree ("is_active");