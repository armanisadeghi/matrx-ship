#!/usr/bin/env tsx
/**
 * Matrx Ship CLI
 *
 * Universal deployment tool that:
 * 1. Provisions a new ship instance on your server (init)
 * 2. Collects git metadata (commit hash, message, code stats)
 * 3. Sends version data to the matrx-ship API
 * 4. Stages, commits, and pushes changes
 *
 * Usage:
 *   pnpm ship "commit message"                              # Patch bump
 *   pnpm ship:minor "commit message"                        # Minor bump
 *   pnpm ship:major "commit message"                        # Major bump
 *   pnpm ship:init my-project "My Project"                  # Auto-provision instance
 *   pnpm ship:init --url URL --key KEY                      # Manual config (legacy)
 *   pnpm ship:setup --token TOKEN [--server URL]            # Save server credentials
 *   pnpm ship status                                        # Show current version
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import * as path from "path";
import { homedir } from "os";

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_MCP_SERVER = "https://mcp.dev.codematrx.com";
const GLOBAL_CONFIG_DIR = path.join(homedir(), ".config", "matrx-ship");
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "server.json");

// ── Types ─────────────────────────────────────────────────────────────

interface ShipConfig {
  url: string;
  apiKey: string;
  projectName?: string;
}

interface ServerConfig {
  server: string;
  token: string;
}

// ── Configuration ────────────────────────────────────────────────────

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

function isPlaceholderUrl(url: string): boolean {
  return (
    url.includes("yourdomain.com") ||
    url.includes("YOUR") ||
    url.includes("example.com") ||
    url.includes("localhost") ||
    url === "" ||
    url === "https://" ||
    url === "http://"
  );
}

function isPlaceholderKey(key: string): boolean {
  return (
    key === "" ||
    key.includes("YOUR") ||
    key.includes("your") ||
    key.includes("xxx") ||
    key === "sk_ship_YOUR_API_KEY_HERE"
  );
}

function loadConfig(): ShipConfig {
  const envUrl = process.env.MATRX_SHIP_URL;
  const envKey = process.env.MATRX_SHIP_API_KEY;

  if (envUrl && envKey) {
    return { url: envUrl.replace(/\/+$/, ""), apiKey: envKey };
  }

  const configPath = findConfigFile();
  if (!configPath) {
    console.error("❌ No .matrx-ship.json found in this project.");
    console.error("");
    console.error("   To set up, run:");
    console.error('     pnpm ship:init my-project "My Project Name"');
    console.error("");
    console.error("   Or set environment variables:");
    console.error("     export MATRX_SHIP_URL=https://ship-myproject.dev.codematrx.com");
    console.error("     export MATRX_SHIP_API_KEY=sk_ship_xxxxx");
    process.exit(1);
  }

  let config: ShipConfig;
  try {
    const raw = readFileSync(configPath, "utf-8");
    config = JSON.parse(raw);
  } catch {
    console.error(`❌ Failed to parse ${configPath}`);
    console.error("   Make sure it contains valid JSON with 'url' and 'apiKey'.");
    process.exit(1);
  }

  if (!config.url || !config.apiKey) {
    console.error(`❌ Missing fields in ${configPath}`);
    console.error('   Required: { "url": "...", "apiKey": "..." }');
    process.exit(1);
  }

  if (isPlaceholderUrl(config.url)) {
    console.error("❌ Your .matrx-ship.json still has a placeholder URL.");
    console.error(`   Current:  ${config.url}`);
    console.error("");
    console.error("   Run this to auto-provision an instance:");
    console.error('     pnpm ship:init my-project "My Project Name"');
    process.exit(1);
  }

  if (isPlaceholderKey(config.apiKey)) {
    console.error("❌ Your .matrx-ship.json still has a placeholder API key.");
    console.error("   Update it with the real key from your matrx-ship instance.");
    console.error(`   Config file: ${configPath}`);
    process.exit(1);
  }

  return { ...config, url: config.url.replace(/\/+$/, "") };
}

// ── Server Config (global) ──────────────────────────────────────────

function loadServerConfig(): ServerConfig | null {
  // 1. Environment variables (highest priority)
  const envToken = process.env.MATRX_SHIP_SERVER_TOKEN;
  const envServer = process.env.MATRX_SHIP_SERVER || DEFAULT_MCP_SERVER;
  if (envToken) {
    return { server: envServer, token: envToken };
  }

  // 2. Global config file
  if (existsSync(GLOBAL_CONFIG_FILE)) {
    try {
      const raw = readFileSync(GLOBAL_CONFIG_FILE, "utf-8");
      const config = JSON.parse(raw);
      if (config.token) {
        return { server: config.server || DEFAULT_MCP_SERVER, token: config.token };
      }
    } catch {
      // Ignore corrupt file
    }
  }

  return null;
}

function saveServerConfig(config: ServerConfig): void {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
  // Restrict permissions
  try {
    execSync(`chmod 600 "${GLOBAL_CONFIG_FILE}"`, { stdio: "ignore" });
  } catch {
    // Windows doesn't have chmod
  }
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

function getCodeStats(): { linesAdded: number; linesDeleted: number; filesChanged: number } {
  try {
    const stats = execSync("git diff --numstat HEAD~1 HEAD").toString().trim();
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
    const status = execSync("git status --porcelain", { encoding: "utf-8" });
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

// ── MCP Client ──────────────────────────────────────────────────────

async function callMcpTool(
  serverConfig: ServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mcpUrl = `${serverConfig.server.replace(/\/+$/, "")}/mcp`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${serverConfig.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: args },
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.status === 401) {
      throw new Error(
        "Authentication failed. Your server token is invalid.\n" +
          "   Run: pnpm ship:setup --token YOUR_TOKEN",
      );
    }

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    // Parse SSE response
    const body = await response.text();
    const dataLine = body.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) {
      throw new Error("Unexpected response format from MCP server");
    }

    const json = JSON.parse(dataLine.replace("data: ", ""));

    if (json.result?.content?.[0]?.text) {
      const text = json.result.content[0].text;
      try {
        return JSON.parse(text);
      } catch {
        // If the text isn't JSON, return it wrapped
        return { message: text };
      }
    }

    if (json.error) {
      throw new Error(json.error.message || "MCP tool call failed");
    }

    return json;
  } catch (error) {
    clearTimeout(timeout);
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes("abort") || msg.includes("timeout")) {
      throw new Error(
        `Connection to MCP server timed out.\n` +
          `   Server: ${serverConfig.server}\n` +
          "   Is the server running?",
      );
    }
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      throw new Error(
        `Cannot reach MCP server at ${serverConfig.server}\n` +
          "   Possible causes:\n" +
          "     - The server is not running\n" +
          "     - The URL is wrong\n" +
          "     - Network/firewall is blocking the connection\n" +
          `\n   To verify: curl ${serverConfig.server}/health`,
      );
    }
    throw error;
  }
}

// ── API Client ───────────────────────────────────────────────────────

async function shipVersion(
  config: ShipConfig,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${config.url}/api/ship`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes("abort") || msg.includes("timeout")) {
      throw new Error(
        `Connection to ${config.url} timed out after 15 seconds.\n` +
          "   Is the matrx-ship server running?",
      );
    }
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      throw new Error(
        `Cannot reach ${config.url}\n` +
          "   Possible causes:\n" +
          "     - The matrx-ship server is not running\n" +
          "     - The URL in .matrx-ship.json is wrong\n" +
          "     - DNS hasn't propagated yet\n" +
          "     - Network/firewall is blocking the connection\n" +
          `\n   To verify, try: curl ${config.url}/api/health`,
      );
    }
    throw new Error(`Network error: ${msg}`);
  }
}

async function getStatus(config: ShipConfig): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${config.url}/api/version`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json();

    console.log("\n📦 Current Version Status");
    console.log(`   Server:  ${config.url}`);
    console.log(`   Version: v${data.version}`);
    console.log(`   Build:   #${data.buildNumber}`);
    console.log(`   Status:  ${data.deploymentStatus || "unknown"}`);
    if (data.gitCommit) console.log(`   Commit:  ${data.gitCommit}`);
    if (data.commitMessage) console.log(`   Message: ${data.commitMessage}`);
    console.log(`   Deployed: ${data.deployedAt}`);
    console.log();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("abort")) {
      console.error(`❌ Cannot reach ${config.url}`);
      console.error("   Is the matrx-ship server running?");
      console.error(`   Try: curl ${config.url}/api/health`);
    } else {
      console.error("❌ Failed to fetch status:", msg);
    }
    process.exit(1);
  }
}

// ── Commands ─────────────────────────────────────────────────────────

async function handleSetup(args: string[]): Promise<void> {
  let token = "";
  let server = DEFAULT_MCP_SERVER;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--token" || args[i] === "-t") && args[i + 1]) {
      token = args[i + 1];
      i++;
    } else if ((args[i] === "--server" || args[i] === "-s") && args[i + 1]) {
      server = args[i + 1];
      i++;
    }
  }

  if (!token) {
    console.error("❌ Usage: pnpm ship:setup --token YOUR_SERVER_TOKEN");
    console.error("");
    console.error("   The server token is the MCP bearer token from your deployment server.");
    console.error("   This is a one-time setup per machine — the token is saved globally.");
    console.error("");
    console.error("   Options:");
    console.error("     --token, -t   MCP server bearer token (required)");
    console.error(`     --server, -s  MCP server URL (default: ${DEFAULT_MCP_SERVER})`);
    console.error("");
    console.error("   You can also set the MATRX_SHIP_SERVER_TOKEN environment variable instead.");
    process.exit(1);
  }

  server = server.replace(/\/+$/, "");

  // Verify connection
  console.log(`🔍 Verifying connection to ${server}...`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${server}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    if (data.status !== "ok") throw new Error("Health check failed");
    console.log(`✅ Connected to server manager`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Cannot reach ${server}/health`);
    if (msg.includes("abort")) {
      console.error("   Connection timed out.");
    } else {
      console.error(`   Error: ${msg}`);
    }
    console.error("   Make sure the MCP server URL is correct and the server is running.");
    process.exit(1);
  }

  // Save
  saveServerConfig({ server, token });
  console.log(`💾 Server credentials saved to ${GLOBAL_CONFIG_FILE}`);
  console.log("");
  console.log("   You can now provision instances in any project:");
  console.log('     pnpm ship:init my-project "My Project Name"');
  console.log("");
}

async function handleInit(args: string[]): Promise<void> {
  // Detect legacy mode: init --url URL --key KEY
  if (args.includes("--url") || args.includes("--key")) {
    return handleLegacyInit(args);
  }

  // New auto-provision mode: init PROJECT_NAME "Display Name" [--token TOKEN] [--server URL]
  let projectName = "";
  let displayName = "";
  let tokenOverride = "";
  let serverOverride = "";

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--token" || args[i] === "-t") && args[i + 1]) {
      tokenOverride = args[i + 1];
      i++;
    } else if ((args[i] === "--server" || args[i] === "-s") && args[i + 1]) {
      serverOverride = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      positional.push(args[i]);
    }
  }

  projectName = positional[0] || "";
  displayName = positional[1] || "";

  // If no project name given, derive from current directory
  if (!projectName) {
    projectName = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
    if (!projectName) {
      console.error("❌ Could not determine project name from directory.");
      console.error('   Usage: pnpm ship:init my-project "My Project Name"');
      process.exit(1);
    }
    console.log(`📁 Using project name from directory: ${projectName}`);
  }

  if (!displayName) {
    // Convert kebab-case to Title Case
    displayName = projectName.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  // Validate project name
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(projectName) && !/^[a-z0-9]$/.test(projectName)) {
    console.error(`❌ Invalid project name: "${projectName}"`);
    console.error("   Must be lowercase letters, numbers, and hyphens only.");
    console.error("   Examples: real-singles, matrx-platform, clawdbot");
    process.exit(1);
  }

  // Load server config
  let serverConfig: ServerConfig | null = null;

  if (tokenOverride) {
    serverConfig = {
      server: serverOverride || DEFAULT_MCP_SERVER,
      token: tokenOverride,
    };
  } else {
    serverConfig = loadServerConfig();
  }

  if (!serverConfig) {
    console.error("❌ No server token found.");
    console.error("");
    console.error("   You need to configure your server credentials first (one-time per machine):");
    console.error("     pnpm ship:setup --token YOUR_MCP_SERVER_TOKEN");
    console.error("");
    console.error("   Or pass the token directly:");
    console.error(`     pnpm ship:init ${projectName} "${displayName}" --token YOUR_TOKEN`);
    console.error("");
    console.error("   Or set the environment variable:");
    console.error("     export MATRX_SHIP_SERVER_TOKEN=your_token_here");
    process.exit(1);
  }

  console.log("");
  console.log("🚀 Provisioning matrx-ship instance...");
  console.log(`   Project:  ${projectName}`);
  console.log(`   Display:  ${displayName}`);
  console.log(`   Server:   ${serverConfig.server}`);
  console.log("");

  // Call MCP app_create
  let result: Record<string, unknown>;
  try {
    result = await callMcpTool(serverConfig, "app_create", {
      name: projectName,
      display_name: displayName,
    });
  } catch (error) {
    console.error("❌ Failed to provision instance");
    console.error("   ", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (result.error) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }

  if (!result.success) {
    console.error("❌ Instance creation failed");
    console.error("   ", JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const instanceUrl = result.url as string;
  const apiKey = result.api_key as string;

  // Write .matrx-ship.json
  const configPath = path.join(process.cwd(), ".matrx-ship.json");
  const config: ShipConfig = { url: instanceUrl, apiKey };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  // Add to .gitignore if needed
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".matrx-ship.json")) {
      writeFileSync(
        gitignorePath,
        gitignore.trimEnd() + "\n\n# Matrx Ship config (contains API key)\n.matrx-ship.json\n",
      );
      console.log("📄 Added .matrx-ship.json to .gitignore");
    }
  }

  // Wait for the instance to boot
  console.log("⏳ Waiting for instance to boot (migrations + seeding)...");
  let healthy = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${instanceUrl}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await response.json();
      if (data.status === "ok") {
        healthy = true;
        break;
      }
    } catch {
      // Still booting
      process.stdout.write(".");
    }
  }

  if (!healthy) {
    console.log("");
    console.log("⚠️  Instance may still be starting up. Check manually:");
    console.log(`   curl ${instanceUrl}/api/health`);
  }

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   ✅ Instance provisioned and configured!                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`   🌐 URL:       ${instanceUrl}`);
  console.log(`   🔧 Admin:     ${instanceUrl}/admin`);
  console.log(`   🔑 API Key:   ${apiKey}`);
  console.log(`   📄 Config:    ${configPath}`);
  console.log("");
  console.log("   You're ready to ship:");
  console.log('     pnpm ship "your first commit message"');
  console.log("");
}

async function handleLegacyInit(args: string[]): Promise<void> {
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
    console.error("❌ Usage: pnpm ship:init --url URL --key API_KEY");
    process.exit(1);
  }

  url = url.replace(/\/+$/, "");

  // Verify connection
  console.log(`🔍 Checking connection to ${url}...`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    if (data.status !== "ok") throw new Error("Health check returned non-ok status");
    console.log(`✅ Connected to ${data.service} (project: ${data.project})`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Cannot reach ${url}/api/health`);
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      console.error("   The server doesn't appear to be running at that URL.");
    } else if (msg.includes("abort")) {
      console.error("   Connection timed out after 10 seconds.");
    } else {
      console.error(`   Error: ${msg}`);
    }
    process.exit(1);
  }

  const config: ShipConfig = { url, apiKey: key };
  const configPath = path.join(process.cwd(), ".matrx-ship.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`📄 Config saved to ${configPath}`);
  console.log('\n   You can now run: pnpm ship "your commit message"');
  console.log();
}

async function handleShip(args: string[]): Promise<void> {
  const isMajor = args.includes("--major");
  const isMinor = args.includes("--minor");
  const commitMessage = args.find((arg) => !arg.startsWith("--"));

  if (!commitMessage) {
    console.error("❌ Error: Commit message is required");
    console.error('\n   Usage: pnpm ship "Your commit message"');
    console.error('          pnpm ship:minor "Your commit message"');
    console.error('          pnpm ship:major "Your commit message"');
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
      throw new Error((result.data.error as string) || "Failed to create version");
    }

    if (result.data.duplicate) {
      console.log(`⚠️  Version already exists for commit ${gitCommit}. Continuing...`);
    } else {
      console.log(`✅ Version v${result.data.version} (build #${result.data.buildNumber}) created`);
    }
  } catch (error) {
    console.error("\n❌ Failed to create version");
    console.error("   ", error instanceof Error ? error.message : String(error));
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
    console.error("   Your commit was created locally but not pushed.");
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

  if (command === "setup") {
    await handleSetup(args.slice(1));
  } else if (command === "init") {
    await handleInit(args.slice(1));
  } else if (command === "status") {
    const config = loadConfig();
    await getStatus(config);
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log(`
Matrx Ship CLI - Universal Deployment Tool

Usage:
  pnpm ship "commit message"             Patch version bump + deploy
  pnpm ship:minor "commit message"       Minor version bump + deploy
  pnpm ship:major "commit message"       Major version bump + deploy

Setup Commands:
  pnpm ship:setup --token TOKEN          Save server credentials (one-time per machine)
  pnpm ship:init PROJECT "Display Name"  Auto-provision an instance on the server
  pnpm ship:init --url URL --key KEY     Manual config (provide your own URL + key)

Info Commands:
  pnpm ship status                       Show current version from server
  pnpm ship help                         Show this help

Environment Variables:
  MATRX_SHIP_SERVER_TOKEN   Server token for provisioning (or use ship:setup)
  MATRX_SHIP_SERVER         MCP server URL (default: ${DEFAULT_MCP_SERVER})
  MATRX_SHIP_URL            Instance URL (overrides .matrx-ship.json)
  MATRX_SHIP_API_KEY        Instance API key (overrides .matrx-ship.json)

Quick Start:
  1. One-time: pnpm ship:setup --token YOUR_SERVER_TOKEN
  2. Per project: pnpm ship:init my-project "My Project"
  3. Ship: pnpm ship "your commit message"
`);
  } else {
    await handleShip(args);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
