#!/usr/bin/env tsx
/**
 * Matrx Ship CLI
 *
 * Universal deployment tool that:
 * 1. Collects git metadata (commit hash, message, code stats)
 * 2. Sends version data to the matrx-ship API
 * 3. Stages all changes
 * 4. Creates git commit
 * 5. Pushes to remote
 *
 * Usage:
 *   matrx-ship "commit message"             # Patch bump
 *   matrx-ship --minor "commit message"     # Minor bump
 *   matrx-ship --major "commit message"     # Major bump
 *   matrx-ship init --url URL --key KEY     # Configure for a project
 *   matrx-ship status                       # Show current version
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";

// ── Configuration ────────────────────────────────────────────────────

interface ShipConfig {
  url: string;
  apiKey: string;
  projectName?: string;
}

function findConfigFile(): string | null {
  let dir = process.cwd();
  while (true) {
    const configPath = path.join(dir, ".matrx-ship.json");
    if (existsSync(configPath)) return configPath;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadConfig(): ShipConfig {
  // Check environment variables first
  const envUrl = process.env.MATRX_SHIP_URL;
  const envKey = process.env.MATRX_SHIP_API_KEY;

  if (envUrl && envKey) {
    return { url: envUrl, apiKey: envKey };
  }

  // Check config file
  const configPath = findConfigFile();
  if (configPath) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      if (config.url && config.apiKey) {
        return config;
      }
    } catch {
      // Fall through to error
    }
  }

  console.error("❌ Not configured. Run: matrx-ship init --url URL --key KEY");
  console.error("   Or set MATRX_SHIP_URL and MATRX_SHIP_API_KEY env vars.");
  process.exit(1);
}

// ── Git Helpers ──────────────────────────────────────────────────────

function getGitCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return null;
  }
}

function getCommitMessage(): string | null {
  try {
    return execSync("git log -1 --pretty=%B").toString().trim();
  } catch {
    return null;
  }
}

function getCodeStats(): {
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
} {
  try {
    const stats = execSync("git diff --numstat HEAD~1 HEAD")
      .toString()
      .trim();
    let linesAdded = 0;
    let linesDeleted = 0;
    let filesChanged = 0;

    if (stats) {
      for (const line of stats.split("\n")) {
        const [added, deleted] = line.trim().split(/\s+/);
        if (added !== "-" && deleted !== "-") {
          linesAdded += parseInt(added) || 0;
          linesDeleted += parseInt(deleted) || 0;
          filesChanged += 1;
        }
      }
    }

    return { linesAdded, linesDeleted, filesChanged };
  } catch {
    return { linesAdded: 0, linesDeleted: 0, filesChanged: 0 };
  }
}

function hasUncommittedChanges(): boolean {
  try {
    const status = execSync("git status --porcelain", {
      encoding: "utf-8",
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

function isGitRepo(): boolean {
  try {
    execSync("git rev-parse --git-dir", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── API Client ───────────────────────────────────────────────────────

async function shipVersion(
  config: ShipConfig,
  payload: Record<string, unknown>,
): Promise<{
  ok: boolean;
  data: Record<string, unknown>;
}> {
  const response = await fetch(`${config.url}/api/ship`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  return { ok: response.ok, data };
}

async function getStatus(config: ShipConfig): Promise<void> {
  try {
    const response = await fetch(`${config.url}/api/version`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    const data = await response.json();

    console.log("\n📦 Current Version Status");
    console.log(`   Version: v${data.version}`);
    console.log(`   Build:   #${data.buildNumber}`);
    console.log(`   Status:  ${data.deploymentStatus || "unknown"}`);
    if (data.gitCommit) console.log(`   Commit:  ${data.gitCommit}`);
    if (data.commitMessage) console.log(`   Message: ${data.commitMessage}`);
    console.log(`   Deployed: ${data.deployedAt}`);
    console.log();
  } catch (error) {
    console.error("❌ Failed to fetch status:", error);
    process.exit(1);
  }
}

// ── Commands ─────────────────────────────────────────────────────────

async function handleInit(args: string[]): Promise<void> {
  let url = "";
  let key = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      url = args[i + 1];
      i++;
    } else if (args[i] === "--key" && args[i + 1]) {
      key = args[i + 1];
      i++;
    }
  }

  if (!url || !key) {
    console.error("❌ Usage: matrx-ship init --url URL --key API_KEY");
    process.exit(1);
  }

  // Verify connection
  try {
    const response = await fetch(`${url}/api/health`);
    const data = await response.json();
    if (data.status !== "ok") {
      throw new Error("Health check failed");
    }
    console.log(`✅ Connected to ${data.service} (${data.project})`);
  } catch (error) {
    console.error(`❌ Cannot reach ${url}/api/health`);
    console.error("   Make sure the matrx-ship instance is running.");
    process.exit(1);
  }

  const config: ShipConfig = { url, apiKey: key };
  const configPath = path.join(process.cwd(), ".matrx-ship.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`📄 Config saved to ${configPath}`);
  console.log("\n   You can now run: matrx-ship \"your commit message\"");
  console.log("   Or add to package.json: \"ship\": \"tsx cli/ship.ts\"");
  console.log();
}

async function handleShip(args: string[]): Promise<void> {
  const isMajor = args.includes("--major");
  const isMinor = args.includes("--minor");
  const commitMessage = args.find((arg) => !arg.startsWith("--"));

  if (!commitMessage) {
    console.error("❌ Error: Commit message is required");
    console.error('\n   Usage: matrx-ship "Your commit message"');
    console.error('          matrx-ship --minor "Your commit message"');
    console.error('          matrx-ship --major "Your commit message"');
    process.exit(1);
  }

  if (!isGitRepo()) {
    console.error("❌ Error: Not in a git repository");
    process.exit(1);
  }

  if (!hasUncommittedChanges()) {
    console.log("⚠️  No uncommitted changes detected. Nothing to ship!");
    process.exit(0);
  }

  const config = loadConfig();
  const bumpType = isMajor ? "major" : isMinor ? "minor" : "patch";

  console.log("🚀 Starting ship process...\n");

  // Step 1: Send version data to API
  console.log("📦 Step 1/4: Creating version...");
  const gitCommit = getGitCommit();
  const codeStats = getCodeStats();

  try {
    const result = await shipVersion(config, {
      bumpType,
      gitCommit,
      commitMessage,
      linesAdded: codeStats.linesAdded,
      linesDeleted: codeStats.linesDeleted,
      filesChanged: codeStats.filesChanged,
    });

    if (!result.ok) {
      throw new Error(
        (result.data.error as string) || "Failed to create version",
      );
    }

    if (result.data.duplicate) {
      console.log(
        `⚠️  Version already exists for commit ${gitCommit}. Continuing...`,
      );
    } else {
      console.log(
        `✅ Version v${result.data.version} (build #${result.data.buildNumber}) created`,
      );
    }
  } catch (error) {
    console.error("\n❌ Failed to create version");
    console.error(
      "   ",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }

  // Step 2: Stage all changes
  console.log("\n📝 Step 2/4: Staging changes...");
  try {
    execSync("git add .", { stdio: "inherit" });
    console.log("✅ Changes staged");
  } catch {
    console.error("\n❌ Failed to stage changes");
    process.exit(1);
  }

  // Step 3: Create commit
  console.log("\n💾 Step 3/4: Creating commit...");
  try {
    const escapedMessage = commitMessage.replace(/"/g, '\\"');
    execSync(`git commit -m "${escapedMessage}"`, { stdio: "inherit" });
    console.log("✅ Commit created");
  } catch {
    console.error("\n❌ Failed to create commit");
    console.error("   Tip: Make sure you have changes to commit");
    process.exit(1);
  }

  // Step 4: Push to remote
  console.log("\n⬆️  Step 4/4: Pushing to remote...");
  try {
    execSync("git push", { stdio: "inherit" });
    console.log("✅ Pushed to remote");
  } catch {
    console.error("\n❌ Failed to push to remote");
    console.error(
      "   Your commit was created locally but not pushed.",
    );
    console.error("   You can manually push with: git push");
    process.exit(1);
  }

  console.log("\n✨ Ship complete!");
  console.log(`   Commit: "${commitMessage}"`);
  console.log("   Changes have been pushed to remote\n");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "init") {
    await handleInit(args.slice(1));
  } else if (command === "status") {
    const config = loadConfig();
    await getStatus(config);
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log(`
Matrx Ship CLI - Universal Deployment Tool

Usage:
  matrx-ship "commit message"             Patch version bump + deploy
  matrx-ship --minor "commit message"     Minor version bump + deploy
  matrx-ship --major "commit message"     Major version bump + deploy
  matrx-ship init --url URL --key KEY     Configure for this project
  matrx-ship status                       Show current version
  matrx-ship help                         Show this help

Environment Variables:
  MATRX_SHIP_URL       Ship instance URL (overrides .matrx-ship.json)
  MATRX_SHIP_API_KEY   API key (overrides .matrx-ship.json)
`);
  } else {
    await handleShip(args);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
