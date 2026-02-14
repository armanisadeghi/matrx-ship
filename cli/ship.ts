#!/usr/bin/env tsx
/// <reference types="node" />
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
 *   pnpm ship:history                                       # Import full git history
 *   pnpm ship:update                                        # Update CLI to latest version
 *   pnpm ship status                                        # Show current version
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import * as path from "path";
import { homedir } from "os";

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_MCP_SERVER = "https://manager.dev.codematrx.com";
const REPO_RAW = "https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main";
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

interface UnifiedConfig {
  ship?: { url?: string; apiKey?: string };
  env?: {
    doppler?: { project?: string; config?: string };
    file?: string;
  };
  [key: string]: unknown;
}

// ── Configuration ────────────────────────────────────────────────────

function findConfigFile(): { path: string; unified: boolean } | null {
  let dir = process.cwd();
  while (true) {
    // Prefer unified .matrx.json (even without ship section — we'll enrich it)
    const unifiedPath = path.join(dir, ".matrx.json");
    if (existsSync(unifiedPath)) {
      try {
        JSON.parse(readFileSync(unifiedPath, "utf-8"));
        return { path: unifiedPath, unified: true };
      } catch { /* fall through — invalid JSON */ }
    }
    // Fall back to legacy .matrx-ship.json
    const legacyPath = path.join(dir, ".matrx-ship.json");
    if (existsSync(legacyPath)) return { path: legacyPath, unified: false };
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

/** Returns the correct command prefix based on whether the project has package.json or Makefile */
function shipCmd(sub?: string): string {
  const cwd = process.cwd();
  const hasPackageJson = existsSync(path.join(cwd, "package.json"));
  if (hasPackageJson) {
    return sub ? `pnpm ship:${sub}` : "pnpm ship";
  }
  const hasMakefile = existsSync(path.join(cwd, "Makefile"));
  if (hasMakefile) {
    if (!sub) return 'make ship MSG="..."';
    if (sub === "minor") return 'make ship-minor MSG="..."';
    if (sub === "major") return 'make ship-major MSG="..."';
    return `make ship-${sub}`;
  }
  return sub ? `bash scripts/matrx/ship.sh ${sub}` : 'bash scripts/matrx/ship.sh "..."';
}

/** Returns the correct env-sync command prefix */
function envCmd(sub: string): string {
  const cwd = process.cwd();
  const hasPackageJson = existsSync(path.join(cwd, "package.json"));
  if (hasPackageJson) {
    return `pnpm env:${sub}`;
  }
  const hasMakefile = existsSync(path.join(cwd, "Makefile"));
  if (hasMakefile) {
    return `make env-${sub}`;
  }
  return `bash scripts/matrx/env-sync.sh ${sub}`;
}

/** Prompt the user with a question and optional default */
async function promptUser(question: string, defaultVal?: string): Promise<string> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultVal ? ` [${defaultVal}]` : "";
  const answer = await new Promise<string>((resolve) => {
    rl.question(`   ${question}${suffix}: `, resolve);
  });
  rl.close();
  return answer.trim() || defaultVal || "";
}

/** Detect a default project name from directory */
function detectProjectName(): string {
  try {
    const dir = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
    return path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  } catch {
    return path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }
}

/** Detect default env file */
function detectEnvFile(): string {
  const cwd = process.cwd();
  for (const candidate of [".env.local", ".env", ".env.development"]) {
    if (existsSync(path.join(cwd, candidate))) return candidate;
  }
  if (existsSync(path.join(cwd, "next.config.ts")) || existsSync(path.join(cwd, "next.config.js"))) {
    return ".env.local";
  }
  return ".env";
}

/**
 * Parse a .env file and return key-value pairs.
 * Handles quoted values, comments, and blank lines.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;

  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      let value = trimmed.substring(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  } catch {
    // Ignore read errors
  }
  return result;
}

/**
 * Scan .env files in the project for ship config values.
 * Checks .env.local, .env, .env.development in order.
 */
function loadEnvFileValues(): { url: string; apiKey: string } {
  const cwd = process.cwd();
  const candidates = [".env.local", ".env", ".env.development"];
  let url = "";
  let apiKey = "";

  for (const candidate of candidates) {
    const envVars = parseEnvFile(path.join(cwd, candidate));
    if (!url && envVars.MATRX_SHIP_URL) url = envVars.MATRX_SHIP_URL;
    if (!apiKey && envVars.MATRX_SHIP_API_KEY) apiKey = envVars.MATRX_SHIP_API_KEY;
    if (url && apiKey) break;
  }

  return { url, apiKey };
}

function loadConfig(): ShipConfig {
  // Priority 1: Process environment variables
  const envUrl = process.env.MATRX_SHIP_URL;
  const envKey = process.env.MATRX_SHIP_API_KEY;

  if (envUrl && envKey && !isPlaceholderUrl(envUrl) && !isPlaceholderKey(envKey)) {
    return { url: envUrl.replace(/\/+$/, ""), apiKey: envKey };
  }

  // Priority 2: .env file values (loaded early so they can fill gaps in JSON config)
  const envFileValues = loadEnvFileValues();

  // Priority 3: JSON config file (.matrx.json or .matrx-ship.json)
  const configResult = findConfigFile();

  // Start with whatever we have from env vars and .env files
  let url = envUrl || envFileValues.url || "";
  let apiKey = envKey || envFileValues.apiKey || "";

  if (configResult) {
    try {
      const raw = readFileSync(configResult.path, "utf-8");
      const parsed = JSON.parse(raw);

      if (configResult.unified) {
        // Unified .matrx.json — ship values come from parsed.ship
        if (parsed.ship?.url && !isPlaceholderUrl(parsed.ship.url)) {
          url = url || parsed.ship.url;
        }
        if (parsed.ship?.apiKey && !isPlaceholderKey(parsed.ship.apiKey)) {
          apiKey = apiKey || parsed.ship.apiKey;
        }
      } else {
        // Legacy .matrx-ship.json — ship values are top-level
        if (parsed.url && !isPlaceholderUrl(parsed.url)) {
          url = url || parsed.url;
        }
        if (parsed.apiKey && !isPlaceholderKey(parsed.apiKey)) {
          apiKey = apiKey || parsed.apiKey;
        }
      }
    } catch {
      // Invalid JSON — fall through to check if env values are sufficient
    }
  }

  // Validate what we have
  if (url && apiKey && !isPlaceholderUrl(url) && !isPlaceholderKey(apiKey)) {
    // If we loaded from env files but JSON config is missing/incomplete, auto-repair it
    if (configResult) {
      try {
        const raw = readFileSync(configResult.path, "utf-8");
        const parsed = JSON.parse(raw);
        if (configResult.unified) {
          const needsUpdate = !parsed.ship?.url || !parsed.ship?.apiKey ||
            isPlaceholderUrl(parsed.ship?.url || "") || isPlaceholderKey(parsed.ship?.apiKey || "");
          if (needsUpdate) {
            parsed.ship = { url: url.replace(/\/+$/, ""), apiKey };
            writeFileSync(configResult.path, JSON.stringify(parsed, null, 2) + "\n");
            console.log(`   ✅ Auto-repaired ${configResult.path} with ship config from environment`);
          }
        }
      } catch {
        // Can't auto-repair — that's OK, we have valid values
      }
    } else {
      // No config file at all — create .matrx.json with the values we found
      const newConfig: UnifiedConfig = { ship: { url: url.replace(/\/+$/, ""), apiKey } };
      const newPath = path.join(process.cwd(), ".matrx.json");
      try {
        writeFileSync(newPath, JSON.stringify(newConfig, null, 2) + "\n");
        console.log(`   ✅ Created .matrx.json from environment values`);
      } catch {
        // Can't write — that's OK, we have valid values in memory
      }
    }

    return { url: url.replace(/\/+$/, ""), apiKey };
  }

  // ── Nothing worked — give a clear, comprehensive error ──

  const projectName = detectProjectName();
  const sources: string[] = [];

  if (!configResult) {
    sources.push("No .matrx.json or .matrx-ship.json found");
  } else {
    sources.push(`Config file ${configResult.path} is missing ship.url and/or ship.apiKey`);
  }

  if (!envUrl && !envKey) {
    sources.push("No MATRX_SHIP_URL / MATRX_SHIP_API_KEY in process environment");
  }

  if (!envFileValues.url && !envFileValues.apiKey) {
    sources.push("No MATRX_SHIP_URL / MATRX_SHIP_API_KEY found in .env files");
  }

  console.error("❌ Ship configuration is incomplete.");
  console.error("");
  console.error("   Checked:");
  for (const src of sources) {
    console.error(`     • ${src}`);
  }
  console.error("");
  console.error("   To fix, do ONE of the following:");
  console.error("");
  console.error("   Option 1 — Auto-provision (recommended):");
  console.error(`     ${shipCmd("init")} ${projectName} "${projectName.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}"`);
  console.error("");
  console.error("   Option 2 — Add to your .env.local or .env file:");
  console.error('     MATRX_SHIP_URL="https://' + projectName + '.dev.codematrx.com"');
  console.error('     MATRX_SHIP_API_KEY="sk_ship_your_key_here"');
  console.error("");
  console.error("   Option 3 — Set environment variables:");
  console.error(`     export MATRX_SHIP_URL=https://${projectName}.dev.codematrx.com`);
  console.error("     export MATRX_SHIP_API_KEY=sk_ship_xxxxx");
  console.error("");
  console.error("   Then run the command again.");
  process.exit(1);
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
        let server = config.server || DEFAULT_MCP_SERVER;
        
        // Auto-migrate old mcp.dev.codematrx.com URLs to manager.dev.codematrx.com
        const oldUrl = "mcp.dev.codematrx.com";
        const newUrl = "manager.dev.codematrx.com";
        if (server.includes(oldUrl)) {
          server = server.replace(oldUrl, newUrl);
          // Save the migrated config
          saveServerConfig({ server, token: config.token });
          console.log(`✓ Migrated server URL from ${oldUrl} to ${newUrl}`);
        }
        
        return { server, token: config.token };
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
        `   Run: ${shipCmd("setup")} --token YOUR_TOKEN`,
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

/**
 * Safely parse a fetch response as JSON with clear error messages.
 * Checks response.ok first to avoid cryptic JSON parse errors on HTML/text error pages.
 */
async function safeJsonResponse(
  response: Response,
  url: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const body = await response.text();

  if (!response.ok) {
    // Try to parse as JSON anyway — some APIs return JSON error bodies
    try {
      const errData = JSON.parse(body) as Record<string, unknown>;
      return { ok: false, data: errData };
    } catch {
      // Not JSON — build a human-readable error
      if (response.status === 404) {
        throw new Error(
          `Server returned 404 Not Found for ${url}\n` +
          "   Possible causes:\n" +
          "     - The matrx-ship instance is not running\n" +
          "     - The URL in .matrx-ship.json is incorrect\n" +
          "     - The route does not exist on the target server\n" +
          `\n   To verify, try: curl ${url.replace(/\/api\/.*/, "/api/health")}`,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Authentication failed (${response.status}) for ${url}\n` +
          "   The API key in your config may be invalid or expired.\n" +
          `   Run: ${shipCmd("init")}  to reconfigure.`,
        );
      }
      throw new Error(
        `Server returned ${response.status} ${response.statusText}\n` +
        `   URL: ${url}\n` +
        `   Response: ${body.slice(0, 300)}`,
      );
    }
  }

  // Response was OK — parse as JSON
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    return { ok: true, data };
  } catch {
    throw new Error(
      `Server returned 200 OK but response is not valid JSON\n` +
      `   URL: ${url}\n` +
      `   Response: ${body.slice(0, 300)}`,
    );
  }
}

async function shipVersion(
  config: ShipConfig,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const url = `${config.url}/api/ship`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return await safeJsonResponse(response, url);
  } catch (error) {
    // Re-throw errors already formatted by safeJsonResponse
    if (error instanceof Error && (
      error.message.includes("Server returned") ||
      error.message.includes("Authentication failed") ||
      error.message.includes("not valid JSON")
    )) {
      throw error;
    }

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
  const url = `${config.url}/api/version`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const { data } = await safeJsonResponse(response, url);

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
    console.error(`❌ Usage: ${shipCmd("setup")} --token YOUR_SERVER_TOKEN`);
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
    const healthUrl = `${server}/health`;
    const response = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const { data } = await safeJsonResponse(response, healthUrl);
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
  console.log(`     ${shipCmd("init")} my-project "My Project Name"`);
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
      console.error(`   Usage: ${shipCmd("init")} my-project "My Project Name"`);
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
    console.error(`     ${shipCmd("setup")} --token YOUR_MCP_SERVER_TOKEN`);
    console.error("");
    console.error("   Or pass the token directly:");
    console.error(`     ${shipCmd("init")} ${projectName} "${displayName}" --token YOUR_TOKEN`);
    console.error("");
    console.error("   Or set the environment variable:");
    console.error("     export MATRX_SHIP_SERVER_TOKEN=your_token_here");
    process.exit(1);
  }

  console.log("");
  console.log("🚀 Provisioning matrx-ship instance...");
  console.log(`   Project:  ${projectName}`);
  console.log(`   Display:  ${displayName}`);
  console.log(`   Server:   ${serverConfig!.server}`);
  console.log("");

  // Call MCP app_create
  let result!: Record<string, unknown>;
  try {
    result = await callMcpTool(serverConfig!, "app_create", {
      name: projectName,
      display_name: displayName,
    });
  } catch (error) {
    console.error("❌ Failed to provision instance");
    console.error("   ", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Handle "already exists" — try to retrieve the existing instance
  const errorMsg = typeof result.error === "string" ? result.error : "";
  if (errorMsg.toLowerCase().includes("already exists")) {
    console.log(`ℹ️  Instance '${projectName}' already exists. Retrieving info...`);
    try {
      const existing = await callMcpTool(serverConfig!, "app_get", { name: projectName });
      if (existing.url && existing.api_key) {
        result = { success: true, url: existing.url, api_key: existing.api_key };
      } else if (existing.instance && typeof existing.instance === "object") {
        const inst = existing.instance as Record<string, unknown>;
        if (inst.url && inst.api_key) {
          result = { success: true, url: inst.url, api_key: inst.api_key };
        }
      }
    } catch {
      // app_get may not exist — fall through to error
    }

    if (!result.success) {
      console.error(`❌ Instance '${projectName}' already exists on the server but could not retrieve its config.`);
      console.error("");
      console.error("   Check the admin UI for the URL and API key:");
      console.error(`     ${serverConfig!.server}/admin/`);
      console.error("");
      console.error("   Then configure manually:");
      console.error(`     ${shipCmd("init")} --url https://${projectName}.dev.codematrx.com --key YOUR_API_KEY`);
      process.exit(1);
    }
  } else if (result.error) {
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

  // Write config — prefer unified .matrx.json, fall back to .matrx-ship.json for compatibility
  let configPath: string;
  const existingUnified = path.join(process.cwd(), ".matrx.json");
  if (existsSync(existingUnified)) {
    // Merge into existing .matrx.json
    try {
      const existing = JSON.parse(readFileSync(existingUnified, "utf-8"));
      existing.ship = { url: instanceUrl, apiKey };
      writeFileSync(existingUnified, JSON.stringify(existing, null, 2) + "\n");
      configPath = existingUnified;
    } catch {
      // If parse fails, write new .matrx.json
      writeFileSync(existingUnified, JSON.stringify({ ship: { url: instanceUrl, apiKey } }, null, 2) + "\n");
      configPath = existingUnified;
    }
  } else {
    // Create new .matrx.json
    configPath = existingUnified;
    writeFileSync(configPath, JSON.stringify({ ship: { url: instanceUrl, apiKey } }, null, 2) + "\n");
  }

  // Add to .gitignore if needed
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    const needsUnified = !gitignore.includes(".matrx.json");
    const needsLegacy = !gitignore.includes(".matrx-ship.json");
    if (needsUnified || needsLegacy) {
      let addition = "";
      if (needsUnified) addition += "\n.matrx.json";
      if (needsLegacy) addition += "\n.matrx-ship.json";
      writeFileSync(
        gitignorePath,
        gitignore.trimEnd() + "\n\n# Matrx config (contains API keys)" + addition + "\n",
      );
      console.log("📄 Updated .gitignore");
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
      const bootHealthUrl = `${instanceUrl}/api/health`;
      const response = await fetch(bootHealthUrl, { signal: controller.signal });
      clearTimeout(timeout);
      const { data } = await safeJsonResponse(response, bootHealthUrl);
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
  console.log("");
  await checkIntegrity();
  console.log("");
  console.log("   You're ready to ship:");
  console.log(`     ${shipCmd()} "your first commit message"`);
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
    console.error(`❌ Usage: ${shipCmd("init")} --url URL --key API_KEY`);
    process.exit(1);
  }

  url = url.replace(/\/+$/, "");

  // Verify connection
  console.log(`🔍 Checking connection to ${url}...`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const initHealthUrl = `${url}/api/health`;
    const response = await fetch(initHealthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const { data } = await safeJsonResponse(response, initHealthUrl);
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
  console.log(`\n   You can now run: ${shipCmd()} "your commit message"`);
  console.log();
}

async function handleShip(args: string[]): Promise<void> {
  const isMajor = args.includes("--major");
  const isMinor = args.includes("--minor");
  const commitMessage = args.find((arg) => !arg.startsWith("--"));

  if (!commitMessage) {
    const ship = shipCmd();
    const minor = shipCmd("minor");
    const major = shipCmd("major");
    console.error("❌ Error: Commit message is required");
    console.error(`\n   Usage: ${ship} "Your commit message"`);
    console.error(`          ${minor} "Your commit message"`);
    console.error(`          ${major} "Your commit message"`);
    return void process.exit(1);
  }

  if (!isGitRepo()) {
    console.error("❌ Error: Not in a git repository");
    return void process.exit(1);
  }

  if (!hasUncommittedChanges()) {
    console.log("⚠️  No uncommitted changes detected. Nothing to ship!");
    return void process.exit(0);
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
  console.log("   Changes have been pushed to remote");

  // Step 5: Verify deployment (optional, non-blocking)
  const shouldVerify = !args.includes("--no-verify");
  if (shouldVerify) {
    console.log("\n🔍 Step 5/5: Verifying deployment...");
    console.log("   (This checks if the server successfully deployed your changes)");

    try {
      // Wait a moment for git hooks to trigger
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Try to check health endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const healthUrl = `${config.url}/api/health`;
      const response = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        console.log(`✅ Deployment verified - server is healthy`);
        if (data.version) {
          console.log(`   Version: ${data.version} (build #${data.buildNumber || '?'})`);
        }
      } else {
        console.log(`⚠️  Server responded with status ${response.status}`);
        console.log(`   The deployment may still be in progress.`);
        console.log(`   Check manually: ${healthUrl}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not verify deployment`);
      console.log(`   This is normal if deployment takes time.`);
      console.log(`   Check manually: ${config.url}/api/health`);
    }
  }

  console.log("");
}

// ── History Import ────────────────────────────────────────────────────

interface GitCommitEntry {
  hash: string;
  date: string;
  message: string;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
}

function parseGitLog(raw: string): GitCommitEntry[] {
  const entries: GitCommitEntry[] = [];
  // Split by our delimiter. Each block starts with "hash\x1edate\x1emessage"
  // followed optionally by a shortstat line.
  const blocks = raw.split("\n");
  let current: Partial<GitCommitEntry> | null = null;

  for (const line of blocks) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Blank line — finalize current entry if stat line not expected
      continue;
    }

    // Check if this is a commit line (contains our \x1e separators)
    if (trimmed.includes("\x1e")) {
      // Save previous entry
      if (current?.hash) {
        entries.push({
          hash: current.hash,
          date: current.date || "",
          message: current.message || "",
          linesAdded: current.linesAdded || 0,
          linesDeleted: current.linesDeleted || 0,
          filesChanged: current.filesChanged || 0,
        });
      }
      const parts = trimmed.split("\x1e");
      current = {
        hash: parts[0],
        date: parts[1] || "",
        message: parts[2] || "",
        linesAdded: 0,
        linesDeleted: 0,
        filesChanged: 0,
      };
    } else if (current && /files? changed/.test(trimmed)) {
      // This is a shortstat line for the current commit
      const filesMatch = trimmed.match(/(\d+) files? changed/);
      const addMatch = trimmed.match(/(\d+) insertions?\(\+\)/);
      const delMatch = trimmed.match(/(\d+) deletions?\(-\)/);
      current.filesChanged = filesMatch ? parseInt(filesMatch[1]) : 0;
      current.linesAdded = addMatch ? parseInt(addMatch[1]) : 0;
      current.linesDeleted = delMatch ? parseInt(delMatch[1]) : 0;
    }
  }

  // Push the last entry
  if (current?.hash) {
    entries.push({
      hash: current.hash,
      date: current.date || "",
      message: current.message || "",
      linesAdded: current.linesAdded || 0,
      linesDeleted: current.linesDeleted || 0,
      filesChanged: current.filesChanged || 0,
    });
  }

  return entries;
}

function assignVersions(
  entries: GitCommitEntry[],
  startVersion: string,
): { version: string; buildNumber: number; entry: GitCommitEntry }[] {
  let [major, minor, patch] = startVersion.split(".").map(Number);
  return entries.map((entry, i) => {
    if (i > 0) patch++;
    return {
      version: `${major}.${minor}.${patch}`,
      buildNumber: i + 1,
      entry,
    };
  });
}

async function handleForceRemove(args: string[]): Promise<void> {
  const instanceName = args.find((arg) => !arg.startsWith("--"));
  const deleteData = args.includes("--delete-data");

  if (!instanceName) {
    console.error("❌ Error: Instance name is required");
    console.error(`\n   Usage: ${shipCmd("force-remove")} INSTANCE_NAME`);
    console.error(`          ${shipCmd("force-remove")} INSTANCE_NAME --delete-data`);
    console.error("");
    console.error("   WARNING: This will forcefully remove the instance even if");
    console.error("            Docker Compose fails. Use with caution!");
    return void process.exit(1);
  }

  const config = loadConfig();

  console.log("");
  console.log("⚠️  FORCE REMOVE - This will forcefully remove the instance");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`   Instance:    ${instanceName}`);
  console.log(`   Server:      ${config.url}`);
  console.log(`   Delete data: ${deleteData ? "YES - All data will be PERMANENTLY deleted" : "NO - Only containers"}`);
  console.log("");
  console.log("   This operation:");
  console.log("   - Removes containers even if Docker Compose fails");
  console.log("   - Removes the instance from the deployment registry");
  if (deleteData) {
    console.log("   - PERMANENTLY DELETES all database data and files");
  }
  console.log("");

  // Confirmation prompt
  console.log("   Type the instance name to confirm: ");
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const confirmation = await new Promise<string>((resolve) => {
    rl.question("   > ", resolve);
  });
  rl.close();

  if (confirmation.trim() !== instanceName) {
    console.log("\n❌ Confirmation failed. Instance name did not match.");
    console.log("   No changes were made.");
    process.exit(1);
  }

  console.log("\n🗑️  Removing instance (forced)...");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const url = new URL(`${config.url}/api/instances/${instanceName}`);
    url.searchParams.set("delete_data", String(deleteData));
    url.searchParams.set("force", "true");

    const response = await fetch(url.toString(), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const { ok: responseOk, data } = await safeJsonResponse(response, url.toString());

    if (!responseOk || !data.success) {
      throw new Error((data.error as string) || "Force remove failed");
    }

    console.log("\n✅ Instance forcefully removed");
    console.log(`   Instance:     ${data.removed}`);
    console.log(`   Data deleted: ${data.data_deleted ? "Yes" : "No"}`);
    console.log(`   Forced:       ${data.forced ? "Yes" : "No"}`);

    if (data.results) {
      const results = data.results as Record<string, unknown>;
      console.log("\n   Cleanup details:");
      if (results.compose_down) {
        const composeDown = results.compose_down as { success: boolean };
        console.log(`   - Docker Compose: ${composeDown.success ? "✓" : "✗"}`);
      }
      if (results.force_cleanup) {
        console.log(`   - Force cleanup: Applied`);
      }
      if (results.directory_deleted) {
        const directoryDeleted = results.directory_deleted as { success: boolean };
        console.log(`   - Directory: ${directoryDeleted.success ? "Deleted" : "Failed to delete"}`);
      }
    }

    console.log("");
  } catch (error) {
    console.error("\n❌ Force remove failed");
    console.error("   ", error instanceof Error ? error.message : String(error));
    console.error("");
    console.error("   You may need to manually clean up:");
    console.error(`   - docker rm -f ${instanceName} db-${instanceName}`);
    console.error(`   - docker volume rm ${instanceName}_pgdata`);
    console.error(`   - rm -rf /srv/apps/${instanceName}`);
    process.exit(1);
  }
}

async function handleHistory(args: string[]): Promise<void> {
  const isDry = args.includes("--dry") || args.includes("--dry-run");
  const isClear = args.includes("--clear");
  let since = "";
  let startVersion = "0.0.1";
  let branch = "";
  const batchSize = 200;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--since" || args[i] === "-s") && args[i + 1]) {
      since = args[i + 1];
      i++;
    } else if ((args[i] === "--start-version" || args[i] === "-v") && args[i + 1]) {
      startVersion = args[i + 1];
      i++;
    } else if ((args[i] === "--branch" || args[i] === "-b") && args[i + 1]) {
      branch = args[i + 1];
      i++;
    }
  }

  if (!isGitRepo()) {
    console.error("❌ Not in a git repository");
    process.exit(1);
  }

  const config = loadConfig();

  console.log("");
  console.log("📚 Matrx Ship — History Import");
  console.log("══════════════════════════════════════════");
  console.log(`   Server:         ${config.url}`);
  console.log(`   Start version:  ${startVersion}`);
  if (since) console.log(`   Since:          ${since}`);
  if (branch) console.log(`   Branch:         ${branch}`);
  if (isClear) console.log(`   Clear existing: YES`);
  if (isDry) console.log(`   Mode:           DRY RUN (no changes)`);
  console.log("");

  // Build the git log command
  // %h = short hash, %aI = author date ISO, %s = subject
  // --shortstat adds file change summary after each commit
  let gitCmd = `git log --reverse --format="%h\x1e%aI\x1e%s" --shortstat`;
  if (since) gitCmd += ` --since="${since}"`;
  if (branch) gitCmd += ` ${branch}`;

  console.log("🔍 Reading git history...");
  let raw!: string;
  try {
    raw = execSync(gitCmd, { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    console.error("❌ Failed to read git history");
    console.error("   ", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const entries = parseGitLog(raw);

  if (entries.length === 0) {
    console.log("⚠️  No commits found in git history.");
    process.exit(0);
  }

  const versioned = assignVersions(entries, startVersion);

  console.log(`   Found ${versioned.length} commits`);
  console.log(`   Oldest: ${entries[0].date.split("T")[0]}  ${entries[0].hash}  ${entries[0].message.substring(0, 60)}`);
  console.log(`   Newest: ${entries[entries.length - 1].date.split("T")[0]}  ${entries[entries.length - 1].hash}  ${entries[entries.length - 1].message.substring(0, 60)}`);
  console.log(`   Versions: ${versioned[0].version} → ${versioned[versioned.length - 1].version}`);

  // Calculate total stats
  const totalAdded = entries.reduce((sum, e) => sum + e.linesAdded, 0);
  const totalDeleted = entries.reduce((sum, e) => sum + e.linesDeleted, 0);
  const totalFiles = entries.reduce((sum, e) => sum + e.filesChanged, 0);
  console.log(`   Total: +${totalAdded.toLocaleString()} / -${totalDeleted.toLocaleString()} across ${totalFiles.toLocaleString()} file changes`);
  console.log("");

  if (isDry) {
    console.log("── Preview (first 20 commits) ──────────────────────");
    for (const v of versioned.slice(0, 20)) {
      const stats = v.entry.filesChanged > 0 ? ` (+${v.entry.linesAdded}/-${v.entry.linesDeleted}, ${v.entry.filesChanged}f)` : "";
      console.log(`   ${v.version} #${v.buildNumber}  ${v.entry.hash}  ${v.entry.date.split("T")[0]}  ${v.entry.message.substring(0, 50)}${stats}`);
    }
    if (versioned.length > 20) {
      console.log(`   ... and ${versioned.length - 20} more`);
    }
    console.log("");
    console.log("   This is a dry run. To actually import, run without --dry:");
    console.log("     " + shipCmd("history") + (isClear ? " --clear" : "") + (since ? ` --since ${since}` : ""));
    console.log("");
    return;
  }

  // Send to API in batches
  console.log("📤 Importing to server...");

  let totalImported = 0;
  let totalSkipped = 0;
  let totalCleared = 0;

  for (let i = 0; i < versioned.length; i += batchSize) {
    const batch = versioned.slice(i, i + batchSize);
    const isFirst = i === 0;

    const payload = {
      versions: batch.map((v) => ({
        version: v.version,
        buildNumber: v.buildNumber,
        gitCommit: v.entry.hash,
        commitMessage: v.entry.message,
        linesAdded: v.entry.linesAdded,
        linesDeleted: v.entry.linesDeleted,
        filesChanged: v.entry.filesChanged,
        deployedAt: v.entry.date,
      })),
      clearExisting: isFirst && isClear,
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(`${config.url}/api/ship/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const importUrl = `${config.url}/api/ship/import`;
      const { ok: importOk, data } = await safeJsonResponse(response, importUrl);

      if (!importOk) {
        throw new Error((data.error as string) || `Server returned ${response.status}`);
      }

      totalImported += (data.imported as number) || 0;
      totalSkipped += (data.skipped as number) || 0;
      if (data.cleared) totalCleared += data.cleared as number;

      const progress = Math.min(i + batchSize, versioned.length);
      process.stdout.write(`\r   Progress: ${progress}/${versioned.length} commits processed`);
    } catch (error) {
      console.error(`\n\n❌ Failed at batch starting index ${i}`);
      console.error("   ", error instanceof Error ? error.message : String(error));
      if (totalImported > 0) {
        console.log(`\n   Partial import: ${totalImported} versions were imported before the error.`);
        console.log("   You can re-run the command safely — duplicates will be skipped.");
      }
      process.exit(1);
    }
  }

  console.log(""); // Clear progress line
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   ✅ History import complete!                                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`   Imported:  ${totalImported} version(s)`);
  if (totalSkipped > 0) console.log(`   Skipped:   ${totalSkipped} (already existed)`);
  if (totalCleared > 0) console.log(`   Cleared:   ${totalCleared} (pre-existing versions removed)`);
  console.log(`   Range:     ${versioned[0].version} → ${versioned[versioned.length - 1].version}`);
  console.log(`   Builds:    #1 → #${versioned.length}`);
  console.log("");
  console.log(`   The next '${shipCmd()}' will continue from where this left off.`);
  console.log(`   View history at: ${config.url}/admin/versions`);
  console.log("");
}

// ── Self-Update ──────────────────────────────────────────────────────

const ALL_PACKAGE_SCRIPTS: Record<string, string> = {
  // Ship commands (use tsx to run ship.ts)
  ship: "__CLI_PATH__",
  "ship:minor": "__CLI_PATH__ --minor",
  "ship:major": "__CLI_PATH__ --major",
  "ship:init": "__CLI_PATH__ init",
  "ship:setup": "__CLI_PATH__ setup",
  "ship:history": "__CLI_PATH__ history",
  "ship:update": "__CLI_PATH__ update",
  "ship:help": "__CLI_PATH__ help",
  "ship:force-remove": "__CLI_PATH__ force-remove",
  // Env-sync commands (bash scripts in the same directory)
  "env:pull": "bash __SCRIPT_DIR__/env-sync.sh pull",
  "env:push": "bash __SCRIPT_DIR__/env-sync.sh push",
  "env:diff": "bash __SCRIPT_DIR__/env-sync.sh diff",
  "env:status": "bash __SCRIPT_DIR__/env-sync.sh status",
  "env:sync": "bash __SCRIPT_DIR__/env-sync.sh sync",
  "env:pull:force": "bash __SCRIPT_DIR__/env-sync.sh pull --force",
  "env:push:force": "bash __SCRIPT_DIR__/env-sync.sh push --force",
  // Meta commands
  "tools:update": `curl -sL ${REPO_RAW}/cli/install.sh | bash`,
  "tools:migrate": `curl -sL ${REPO_RAW}/cli/migrate.sh | bash`,
};

function ensurePackageJsonScripts(cliRelPath: string): boolean {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (!pkg.scripts) pkg.scripts = {};

    const cliPrefix = `tsx ${cliRelPath}`;
    const scriptDir = path.dirname(cliRelPath);
    let changed = false;

    for (const [name, template] of Object.entries(ALL_PACKAGE_SCRIPTS)) {
      const cmd = template
        .replace(/__CLI_PATH__/g, cliPrefix)
        .replace(/__SCRIPT_DIR__/g, scriptDir);
      if (pkg.scripts[name] !== cmd) {
        pkg.scripts[name] = cmd;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    }
    return changed;
  } catch {
    return false;
  }
}

function ensureGitignore(): boolean {
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  let content = "";
  let existed = false;

  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
    existed = true;
  }

  const entries = [
    ".matrx.json",
    ".matrx-ship.json",
    ".matrx-tools.conf",
    ".env-backups/",
  ];

  const missing = entries.filter((e) => !content.includes(e));
  if (missing.length === 0) return false;

  try {
    const addition = "\n# Matrx config (contains API keys)\n" + missing.join("\n") + "\n";
    if (existed) {
      writeFileSync(gitignorePath, content.trimEnd() + "\n" + addition);
    } else {
      writeFileSync(gitignorePath, addition.trimStart());
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures tsx is in devDependencies for npm projects.
 * This is critical for ship CLI to work properly.
 * Checks all dependency locations and adds to devDependencies if missing.
 */
function ensureTsxDependency(): void {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const hasTsx =
      pkg.dependencies?.tsx || pkg.devDependencies?.tsx || pkg.optionalDependencies?.tsx;

    if (hasTsx) {
      return; // Already installed
    }

    // tsx is missing — add it to devDependencies and install
    console.log("📦 Adding tsx to devDependencies (required for ship CLI)...");

    // Add to package.json
    if (!pkg.devDependencies) pkg.devDependencies = {};
    pkg.devDependencies.tsx = "^4.21.0";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

    // Detect package manager and install
    try {
      if (existsSync("pnpm-lock.yaml") || existsSync("pnpm-workspace.yaml")) {
        execSync("pnpm install", { stdio: "inherit" });
        console.log("✅ tsx installed via pnpm");
      } else if (existsSync("yarn.lock")) {
        execSync("yarn install", { stdio: "inherit" });
        console.log("✅ tsx installed via yarn");
      } else if (existsSync("bun.lockb") || existsSync("bun.lock")) {
        execSync("bun install", { stdio: "inherit" });
        console.log("✅ tsx installed via bun");
      } else {
        execSync("npm install", { stdio: "inherit" });
        console.log("✅ tsx installed via npm");
      }
    } catch {
      console.log("⚠️  Could not auto-install tsx. Run your package manager's install command.");
    }
  } catch (error) {
    console.log("⚠️  Could not check/install tsx:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Download a single file from the GitHub repo. Returns true on success.
 * Non-fatal: logs a warning on failure so the update can continue.
 */
async function downloadFile(url: string, dest: string, label: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`   ⚠️  Could not download ${label} (HTTP ${response.status})`);
      return false;
    }

    const fileContent = await response.text();
    const dir = path.dirname(dest);
    mkdirSync(dir, { recursive: true });
    writeFileSync(dest, fileContent, "utf-8");
    return true;
  } catch {
    console.log(`   ⚠️  Could not download ${label}`);
    return false;
  }
}

/**
 * Ensure the .matrx.json (unified config) exists and is valid.
 * - If .matrx.json already exists → validate it
 * - If only legacy .matrx-ship.json exists → auto-migrate to .matrx.json
 * - If nothing exists → print clear instructions
 *
 * Returns true if config is healthy, false if the user needs to take action.
 */
/**
 * Centralized integrity check:
 * 1. Migrates legacy configs (.matrx-ship.json, .matrx-tools.conf) → .matrx.json
 * 2. Prompts to delete legacy files after migration
 * 3. Validates unified config (Ship + Env)
 * 4. Interactively prompts for missing values (Doppler config, Env file, etc.)
 * 5. Cleans up package.json (removes old scripts)
 * 6. Ensures .gitignore rules
 */
async function checkIntegrity(cliPath: string = "cli/ship.ts"): Promise<boolean> {
  const cwd = process.cwd();
  const unifiedPath = path.join(cwd, ".matrx.json");
  const legacyShipPath = path.join(cwd, ".matrx-ship.json");
  const legacyConfPath = path.join(cwd, ".matrx-tools.conf");

  console.log("🔍 Checking project integrity...");

  // ── 1. Load / Initialize Config ──
  let config: UnifiedConfig = {};
  if (existsSync(unifiedPath)) {
    try {
      config = JSON.parse(readFileSync(unifiedPath, "utf-8"));
    } catch {
      console.log("   ⚠️  .matrx.json exists but is invalid — treating as empty");
      config = {};
    }
  }

  // ── 2. Migration Logic ──
  let migrated = false;

  // Migrate .matrx-ship.json
  if (existsSync(legacyShipPath)) {
    try {
      const legacy = JSON.parse(readFileSync(legacyShipPath, "utf-8"));
      if (legacy.url && legacy.apiKey && (!config.ship || !config.ship.url)) {
        config.ship = { url: legacy.url, apiKey: legacy.apiKey };
        migrated = true;
        console.log("   ✅ Migrated ship config from .matrx-ship.json");
      }

      // Prompt to delete
      const ans = await promptUser("Delete legacy .matrx-ship.json? (y/n)", "y");
      if (ans.toLowerCase().startsWith("y")) {
        try { unlinkSync(legacyShipPath); console.log("   🗑️  Deleted .matrx-ship.json"); } catch { }
      }
    } catch { }
  }

  // Migrate .matrx-tools.conf
  if (existsSync(legacyConfPath)) {
    try {
      const confContent = readFileSync(legacyConfPath, "utf-8");
      const getVal = (key: string) => {
        const m = confContent.match(new RegExp(`^${key}="?([^"\\n]*)"?`, "m"));
        return m ? m[1] : "";
      };

      const dp = getVal("DOPPLER_PROJECT");
      const dc = getVal("DOPPLER_CONFIG");
      const ef = getVal("ENV_FILE");

      if (dp && (!config.env || !config.env.doppler)) {
        config.env = {
          doppler: { project: dp, config: dc || "dev" },
          file: ef || ".env",
        };
        migrated = true;
        console.log("   ✅ Migrated env config from .matrx-tools.conf");
      }

      const ans = await promptUser("Delete legacy .matrx-tools.conf? (y/n)", "y");
      if (ans.toLowerCase().startsWith("y")) {
        try { unlinkSync(legacyConfPath); console.log("   🗑️  Deleted .matrx-tools.conf"); } catch { }
      }
    } catch { }
  }

  // ── 3. Validation & Interactive Setup ──
  let needsSave = migrated;

  // Extract defaults from current config, env vars, AND .env files
  const envFileVals = loadEnvFileValues();
  const current = {
    shipUrl: config.ship?.url || process.env.MATRX_SHIP_URL || envFileVals.url || "",
    shipKey: config.ship?.apiKey || process.env.MATRX_SHIP_API_KEY || envFileVals.apiKey || "",
    dopplerProject: config.env?.doppler?.project || detectProjectName(),
    dopplerConfig: config.env?.doppler?.config || "dev",
    envFile: config.env?.file || detectEnvFile(),
  };

  // If we found ship values from env vars / .env files but not in the JSON, auto-repair
  if (current.shipUrl && current.shipKey &&
      !isPlaceholderUrl(current.shipUrl) && !isPlaceholderKey(current.shipKey) &&
      (!config.ship?.url || !config.ship?.apiKey)) {
    config.ship = { url: current.shipUrl, apiKey: current.shipKey };
    needsSave = true;
    console.log("   ✅ Auto-repaired ship config from environment/.env values");
  }

  const isShipOk = current.shipUrl &&
    current.shipKey &&
    !isPlaceholderUrl(current.shipUrl) &&
    !isPlaceholderKey(current.shipKey);
  const isEnvOk = !!(config.env && config.env.doppler && config.env.file);

  if (!isShipOk) {
    console.log("   ⚠️  Ship configuration missing or incomplete.");
    console.log("");
    console.log("   ╔════════════════════════════════════════════════════════════╗");
    console.log("   ║  RECOMMENDED: Auto-provision a ship instance              ║");
    console.log("   ╚════════════════════════════════════════════════════════════╝");
    console.log("");
    const projectName = detectProjectName();
    console.log(`   Exit this update and run:`);
    console.log(`   ${shipCmd("init")} ${projectName} "${projectName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}"`);
    console.log("");
    console.log("   ─────────────────────────────────────────────────────────────");
    console.log("   Or manually enter your existing instance details:");
    console.log("   (Full URL required, e.g., https://project.dev.codematrx.com)");
    console.log("");

    const urlInput = await promptUser("Ship URL (or press Enter to skip)", "");

    // If user skipped, don't save invalid config
    if (!urlInput || urlInput.trim() === "") {
      console.log("");
      console.log("   ⚠️  Skipped ship configuration.");
      console.log(`   Run the init command above to set up automatically.`);
      console.log("");
      return false;
    }

    // Validate URL format
    if (isPlaceholderUrl(urlInput) || !urlInput.startsWith("http")) {
      console.log("");
      console.log(`   ❌ Invalid URL: "${urlInput}"`);
      console.log("   URL must start with https:// or http://");
      console.log(`   Example: https://${projectName}.dev.codematrx.com`);
      console.log("");
      console.log(`   Run: ${shipCmd("init")} ${projectName} "Project Name"`);
      console.log("");
      return false;
    }

    current.shipUrl = urlInput;
    current.shipKey = await promptUser("Ship API Key", "");

    // Validate the key too
    if (!current.shipKey || isPlaceholderKey(current.shipKey)) {
      console.log("");
      console.log("   ❌ Invalid API key.");
      console.log(`   Run: ${shipCmd("init")} ${projectName} "Project Name"`);
      console.log("");
      return false;
    }

    needsSave = true;
  }

  // If env is missing or incomplete, prompt effectively
  if (!isEnvOk) {
    // Check if we should prompt
    if (!config.env) {
      console.log("");
      console.log("   📋 Env-sync setup (syncs local .env with Doppler)");
      const setupEnv = await promptUser("Configure env-sync? (y/n)", "y");
      if (setupEnv.toLowerCase().startsWith("y")) {
        current.dopplerProject = await promptUser("Doppler Project", current.dopplerProject);
        current.dopplerConfig = await promptUser("Doppler Config", current.dopplerConfig);
        current.envFile = await promptUser("Env File", current.envFile);

        config.env = {
          doppler: { project: current.dopplerProject, config: current.dopplerConfig },
          file: current.envFile
        };
        needsSave = true;
      }
    }
  }

  if (needsSave) {
    // Only save ship config if we have valid values
    if (current.shipUrl && current.shipKey &&
      !isPlaceholderUrl(current.shipUrl) &&
      !isPlaceholderKey(current.shipKey)) {
      config.ship = { url: current.shipUrl, apiKey: current.shipKey };
    }
    // env already updated
    writeFileSync(unifiedPath, JSON.stringify(config, null, 2) + "\n");
    console.log("   ✅ Updated .matrx.json");
  } else {
    console.log("   ✓  Config (.matrx.json) is valid");
  }

  // ── 4. Package.json Cleanup ──
  const pkgPath = path.join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts) {
        const obsolete = ["deploy", "release", "ship-old"];
        let pkgChanged = false;
        for (const s of obsolete) {
          if (pkg.scripts[s]) {
            delete pkg.scripts[s];
            console.log(`   🗑️  Removed deprecated script: ${s}`);
            pkgChanged = true;
          }
        }
        if (pkgChanged) {
          writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
          console.log("   ✅ Cleaned up package.json (removed obsolete scripts)");
        }
      }
    } catch { }
  }

  // ── 5. Gitignore Cleanup ──
  const gitignorePath = path.join(cwd, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      let content = readFileSync(gitignorePath, "utf-8");
      const required = [".matrx.json", ".matrx-ship.json", ".matrx-tools.conf", ".env-backups/"];
      const missing = required.filter(r => !content.includes(r));
      if (missing.length > 0) {
        content = content.trimEnd() + "\n\n# Matrx Config\n" + missing.join("\n") + "\n";
        writeFileSync(gitignorePath, content);
        console.log("   ✅ Updated .gitignore");
      }
    } catch { }
  }

  // ── 6. Ensure tsx dependency ──
  if (existsSync(pkgPath)) {
    ensureTsxDependency();
  }

  console.log("   ✨ Project integrity verified");
  console.log("");
  return true;
}

async function handleUpdate(): Promise<void> {
  console.log("");
  console.log("🔄 Updating Matrx Ship CLI...");
  console.log("══════════════════════════════════════════");
  console.log("");

  // Determine where the current script lives
  const currentScript = path.resolve(process.argv[1]);
  const scriptDir = path.dirname(currentScript);
  const cwd = process.cwd();
  const relPath = path.relative(cwd, currentScript);
  const hasPackageJson = existsSync(path.join(cwd, "package.json"));

  console.log(`   Script directory: ${path.relative(cwd, scriptDir) || "."}`);
  console.log("");

  // ── Step 1: Download all CLI files ──
  console.log("📥 Step 1/5: Downloading latest CLI files...");

  // Always download ship.ts (the core CLI)
  let shipTsOk = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${REPO_RAW}/cli/ship.ts`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}: ${response.statusText}`);
    }
    const shipContent = await response.text();

    if (!shipContent.includes("Matrx Ship CLI")) {
      throw new Error("Downloaded file doesn't look like the ship CLI");
    }

    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(currentScript, shipContent, "utf-8");
    console.log("   ✅ ship.ts");
    shipTsOk = true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("   ❌ Failed to download ship.ts");
    if (msg.includes("abort")) {
      console.error("      Connection timed out. Check your internet connection.");
    } else {
      console.error(`      ${msg}`);
    }
    process.exit(1);
  }

  // Download env-sync.sh
  const envSyncPath = path.join(scriptDir, "env-sync.sh");
  const envSyncOk = await downloadFile(
    `${REPO_RAW}/cli/env-sync.sh`,
    envSyncPath,
    "env-sync.sh",
  );
  if (envSyncOk) {
    try { execSync(`chmod +x "${envSyncPath}"`, { stdio: "ignore" }); } catch { /* Windows */ }
    console.log("   ✅ env-sync.sh");
  }

  // Download lib files
  const libDir = path.join(scriptDir, "lib");
  const colorsOk = await downloadFile(
    `${REPO_RAW}/cli/lib/colors.sh`,
    path.join(libDir, "colors.sh"),
    "lib/colors.sh",
  );
  if (colorsOk) console.log("   ✅ lib/colors.sh");

  const utilsOk = await downloadFile(
    `${REPO_RAW}/cli/lib/utils.sh`,
    path.join(libDir, "utils.sh"),
    "lib/utils.sh",
  );
  if (utilsOk) console.log("   ✅ lib/utils.sh");

  // For non-Node projects, also update the bash wrapper
  if (!hasPackageJson) {
    const wrapperPath = path.join(scriptDir, "ship.sh");
    const wrapperOk = await downloadFile(
      `${REPO_RAW}/cli/ship.sh`,
      wrapperPath,
      "ship.sh",
    );
    if (wrapperOk) {
      try { execSync(`chmod +x "${wrapperPath}"`, { stdio: "ignore" }); } catch { /* Windows */ }
      console.log("   ✅ ship.sh");
    }
  }

  console.log("");

  // ── Step 2: Register commands ──
  console.log("📋 Step 2/5: Registering commands...");

  if (hasPackageJson) {
    const scriptsUpdated = ensurePackageJsonScripts(relPath);
    if (scriptsUpdated) {
      console.log("   ✅ package.json scripts updated (ship + env + tools)");
    } else {
      console.log("   ✓  package.json scripts already up to date");
    }
  } else {
    // TODO: update Makefile targets for non-Node projects
    console.log("   ✓  Non-Node project (use Makefile or bash scripts directly)");
  }
  console.log("");

  // ── Step 3: Ensure dependencies ──
  console.log("📦 Step 3/5: Checking dependencies...");

  if (hasPackageJson) {
    ensureTsxDependency();
    console.log("   ✓  tsx dependency OK");
  } else {
    // Check for npx + tsx availability
    try {
      execSync("npx tsx --version", { stdio: "ignore" });
      console.log("   ✓  npx tsx available");
    } catch {
      console.log("   ⚠️  npx tsx not found. Install Node.js for Ship CLI.");
    }
  }
  console.log("");

  // ── Step 4: Validate config ──
  console.log("🔧 Step 4/5: Integrity Check & Cleanup...");
  const configOk = await checkIntegrity();
  console.log("");

  // ── Step 5: Gitignore ──
  console.log("📄 Step 5/5: Checking .gitignore...");
  const gitignoreUpdated = ensureGitignore();
  if (gitignoreUpdated) {
    console.log("   ✅ Updated .gitignore with config entries");
  } else {
    console.log("   ✓  .gitignore already up to date");
  }

  // ── Summary ──
  console.log("");
  console.log("══════════════════════════════════════════");
  if (configOk) {
    console.log("✅ Matrx Ship CLI is fully up to date!");
  } else {
    console.log("⚠️  CLI files updated, but configuration needs attention (see above).");
  }
  console.log(`   Run '${shipCmd("help")}' to see all commands.`);
  console.log("");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Ensure tsx is in devDependencies for npm projects (except for help command)
  // This is a safety check to ensure the CLI can run properly
  if (command !== "help" && command !== "--help" && command !== "-h") {
    const pkgPath = path.join(process.cwd(), "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const hasTsx = pkg.dependencies?.tsx || pkg.devDependencies?.tsx || pkg.optionalDependencies?.tsx;
        if (!hasTsx) {
          // Silently ensure tsx is added - this will only trigger on first run
          ensureTsxDependency();
        }
      } catch {
        // Ignore errors - ensureTsxDependency will handle it if needed
      }
    }
  }

  if (command === "setup") {
    await handleSetup(args.slice(1));
  } else if (command === "init") {
    await handleInit(args.slice(1));
  } else if (command === "history") {
    await handleHistory(args.slice(1));
  } else if (command === "force-remove") {
    await handleForceRemove(args.slice(1));
  } else if (command === "update") {
    await handleUpdate();
  } else if (command === "status") {
    const config = loadConfig();
    await getStatus(config);
  } else if (command === "help" || command === "--help" || command === "-h") {
    // Use shipCmd() for all command examples — auto-detects pnpm vs make vs bash
    const cmd = shipCmd;
    const env = envCmd;
    const ship = cmd();
    const minor = cmd("minor");
    const major = cmd("major");

    console.log(`
Matrx CLI - Ship + Env-Sync + Tools
════════════════════════════════════════

🚀 Ship (version tracking + deploy):
  ${ship} "commit message"                  Patch version bump + deploy
  ${minor} "commit message"                 Minor version bump + deploy
  ${major} "commit message"                 Major version bump + deploy
  ${ship} status                            Show current version from server

🔐 Env-Sync (Doppler secret management):
  ${env("status")}                          Quick summary of sync state
  ${env("diff")}                            Show differences (local vs Doppler)
  ${env("pull")}                            Safe merge from Doppler → local
  ${env("push")}                            Safe merge from local → Doppler
  ${env("sync")}                            Interactive per-key conflict resolution
  ${env("pull:force")}                      Full replace local from Doppler
  ${env("push:force")}                      Full replace Doppler from local

⚙️  Setup:
  ${cmd("setup")} --token TOKEN             Save server credentials (one-time per machine)
  ${cmd("init")} PROJECT "Display Name"     Auto-provision a Ship instance
  ${cmd("init")} --url URL --key KEY        Manual config (provide your own URL + key)

📚 History:
  ${cmd("history")}                         Import full git history into ship
  ${cmd("history")} --dry                   Preview what would be imported
  ${cmd("history")} --clear                 Clear existing versions and reimport
  ${cmd("history")} --since 2024-01-01      Only import commits after a date

🔧 Maintenance:
  ${cmd("update")}                          Update CLI + integrity check + cleanup
  ${cmd("force-remove")} INSTANCE           Forcefully remove a broken instance
  ${ship} help                              Show this help

📋 Environment Variables:
  MATRX_SHIP_SERVER_TOKEN   Server token for provisioning (or use ${cmd("setup")})
  MATRX_SHIP_SERVER         MCP server URL (default: ${DEFAULT_MCP_SERVER})
  MATRX_SHIP_URL            Instance URL (overrides config)
  MATRX_SHIP_API_KEY        Instance API key (overrides config)
`);
  } else {
    await handleShip(args);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
