import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * app_version table — tracks every deployment / ship event.
 * Schema carried over from the real-singles Supabase implementation.
 */
export const appVersion = pgTable(
  "app_version",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: text("version").notNull(),
    buildNumber: integer("build_number").notNull().default(1),
    gitCommit: text("git_commit"),
    commitMessage: text("commit_message"),
    linesAdded: integer("lines_added"),
    linesDeleted: integer("lines_deleted"),
    filesChanged: integer("files_changed"),
    deployedAt: timestamp("deployed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deploymentStatus: text("deployment_status").default("pending"),
    vercelDeploymentId: text("vercel_deployment_id"),
    vercelDeploymentUrl: text("vercel_deployment_url"),
    deploymentError: text("deployment_error"),
  },
  (table) => [
    index("idx_app_version_vercel_deployment_id").on(table.vercelDeploymentId),
    index("idx_app_version_git_commit").on(table.gitCommit),
    index("idx_app_version_build_number").on(table.buildNumber),
  ],
);

/**
 * api_keys table — stores API keys for authenticating CLI and client requests.
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  isActive: integer("is_active").notNull().default(1),
});

// Type exports for use across the app
export type AppVersion = typeof appVersion.$inferSelect;
export type NewAppVersion = typeof appVersion.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
