import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync, chmodSync, renameSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { cpus, totalmem, freemem, uptime as osUptime, hostname } from "node:os";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  isSupabaseConfigured,
  ensureServerRegistered,
  syncInstance,
  syncAllInstances,
  removeInstanceFromSupabase,
  recordBuildInSupabase,
  recordBackupInSupabase,
  auditLog,
  readAuditLog,
  fullSync,
  fullRestore,
} from "./supabase.js";
import {
  awsConfigured,
  awsRegion,
  ssmRun,
  ssmInstances,
  ec2Describe,
  ec2Power,
  FLEET_HOSTS,
} from "./aws.js";
import {
  gwEnabled,
  mintAgentToken,
  verifyAgentToken,
  parseTarget,
  revokeJti,
} from "./agent_gateway.js";
import {
  fsList,
  fsStat,
  fsRead,
  fsWrite,
  fsMkdir,
  fsPatch,
  searchContent,
  searchPaths,
} from "./agent_gateway_fs.js";
import http from "node:http";
import { attachTerminalWs } from "./terminal_ws.js";
import { oauthEnabled, authenticateOAuthAdmin } from "./oauth_auth.js";

const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Host paths mounted into the container
const HOST_SRV = "/host-srv";     // /srv on host
const HOST_DATA = "/host-data";   // /data on host

// App deployment paths
const APPS_DIR = join(HOST_SRV, "apps");
const DEPLOYMENTS_FILE = join(APPS_DIR, "deployments.json");
const BACKUPS_DIR = join(APPS_DIR, "backups");
const TOKENS_FILE = join(APPS_DIR, "tokens.json");
const DOMAIN_SUFFIX = "dev.codematrx.com";
const BUILD_HISTORY_FILE = join(APPS_DIR, "build-history.json");

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  TOKEN STORE                                                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function loadTokens() {
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, "utf-8"));
  } catch {
    return { tokens: [] };
  }
}

function saveTokens(store) {
  writeFileAtomic(TOKENS_FILE, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

// Constant-time string compare that doesn't leak length-mismatch via early return.
// Hashes both sides to a fixed-length digest first so timingSafeEqual never throws
// on differing lengths and the comparison cost is independent of where they differ.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Throttle last_used_at persistence: writing tokens.json on every authenticated
// request caused concurrent-write clobbering and needless disk churn. Only flush
// when the timestamp is stale by > this window.
const TOKEN_LAST_USED_FLUSH_MS = 60_000;

function verifyToken(bearerToken) {
  if (!bearerToken) return null;

  // Check environment variable tokens first (for dev and production).
  // Timing-safe compare so token bytes can't be recovered via response timing.
  const envTokens = process.env.MANAGER_TOKENS?.split(',').map(t => t.trim()).filter(Boolean) || [];
  if (envTokens.some((t) => safeEqual(t, bearerToken))) {
    return {
      id: 'env_token',
      token_hash: '',
      label: 'Environment Token',
      role: 'admin',
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    };
  }

  // Fall back to tokens.json file (for managed tokens). Lookup is by SHA-256 of
  // the presented token, so the comparison value isn't attacker-tunable.
  const hash = hashToken(bearerToken);
  const store = loadTokens();
  const entry = store.tokens.find((t) => t.token_hash === hash);
  if (!entry) return null;
  // Update last_used_at, but only persist occasionally to avoid write storms.
  const now = Date.now();
  const prev = entry.last_used_at ? Date.parse(entry.last_used_at) : 0;
  if (!prev || now - prev > TOKEN_LAST_USED_FLUSH_MS) {
    entry.last_used_at = new Date(now).toISOString();
    try { saveTokens(store); } catch { /* non-fatal: auth still succeeds */ }
  }
  return entry;
}

// Auto-migrate: import MANAGER_BEARER_TOKEN as admin token on first boot
function initTokenStore() {
  // Support both new and legacy env var names for backward compatibility
  const envToken = process.env.MANAGER_BEARER_TOKEN || process.env.MCP_BEARER_TOKEN;
  if (!envToken) {
    console.log("WARNING: No MANAGER_BEARER_TOKEN set — auth is disabled");
    return;
  }

  let store = loadTokens();
  const envHash = hashToken(envToken);

  // Check if already imported
  if (store.tokens.some((t) => t.token_hash === envHash)) {
    console.log(`Token store: ${store.tokens.length} token(s) loaded`);
    return;
  }

  // Import env token as first admin
  store.tokens.push({
    id: `tok_${randomBytes(6).toString("hex")}`,
    token_hash: envHash,
    label: "Admin (auto-imported from MANAGER_BEARER_TOKEN)",
    role: "admin",
    created_at: new Date().toISOString(),
    last_used_at: null,
  });
  saveTokens(store);
  console.log(`Token store: imported MANAGER_BEARER_TOKEN as admin, ${store.tokens.length} token(s) total`);
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  AUTH MIDDLEWARE                                                           ║
// ╚════════════════════════════════════════════════════════════════════════════╝

async function authMiddleware(req, res, next) {
  // Auth is "configured" if ANY scheme is set: operator tokens (env or store)
  // or the AI Matrx OAuth admin path. Nothing configured = fully open (dev).
  const hasAuth = !!(process.env.MANAGER_TOKENS || process.env.MANAGER_BEARER_TOKEN || process.env.MCP_BEARER_TOKEN || oauthEnabled());
  if (!hasAuth) return next();

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized — Bearer token required" });
  }
  const token = auth.replace("Bearer ", "");

  // 1) Operator token (env-defined or managed in tokens.json). The break-glass
  //    root path — CLI, Deploy server, MCP agents, and the bootstrap admin.
  //    An admin-role operator token counts as superadmin (highest privilege).
  const entry = verifyToken(token);
  if (entry) {
    req.tokenEntry = entry;
    req.tokenRole = entry.role;
    req.isSuperadmin = entry.role === "admin";
    req.authKind = "token";
    return next();
  }

  // 2) AI Matrx OAuth admin (Supabase JWT). Verified signature + present in
  //    public.admins. Superadmin = admins.level == "super_admin".
  if (oauthEnabled()) {
    try {
      const r = await authenticateOAuthAdmin(token);
      if (r.ok) {
        req.tokenEntry = { label: r.email || "oauth-admin", role: "admin" };
        req.tokenRole = "admin";
        req.isSuperadmin = r.isSuperadmin;
        req.authKind = "oauth";
        req.oauthUser = { email: r.email, userId: r.userId, level: r.level };
        return next();
      }
      if (r.reason === "not_admin") {
        return res.status(403).json({ error: "Not an authorized admin", email: r.email });
      }
    } catch {
      // fall through to 401
    }
  }

  return res.status(401).json({ error: "Unauthorized — invalid token" });
}

// Gate a route to superadmins only (operator admin tokens, or OAuth admins
// whose admins.level == "super_admin"). Mirrors requireRole's open-when-unauthed
// behavior so a fully-open dev deployment isn't broken.
function requireSuperadmin(req, res, next) {
  if (!req.tokenRole) return next(); // auth disabled
  if (!req.isSuperadmin) return res.status(403).json({ error: "Forbidden — requires superadmin" });
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.tokenRole) return next(); // Auth disabled
    if (roles.includes(req.tokenRole)) return next();
    return res.status(403).json({ error: `Forbidden — requires role: ${roles.join(" or ")}` });
  };
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  HELPERS                                                                  ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function exec(cmd, { timeout = 30000, cwd } = {}) {
  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      cwd,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return { success: true, output: result.trim() };
  } catch (error) {
    return {
      success: false,
      output: error.stdout?.trim() || "",
      error: error.stderr?.trim() || error.message,
      exitCode: error.status,
    };
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

// ── Input safety ─────────────────────────────────────────────────────────────
// Instance/container names flow into shell-built `docker` commands all over this
// file. The create path validates the name, but the per-:name read/write routes
// historically did not re-check the path param — so a crafted name like
// `foo; docker run …` could inject. This is the canonical validator: legitimate
// instance names already conform, so it only rejects attacks.
const INSTANCE_NAME_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
function isValidInstanceName(name) {
  return typeof name === "string" && name.length <= 63 && INSTANCE_NAME_RE.test(name);
}
// Express middleware: 400 on a bad :name param before any handler runs.
function requireValidName(req, res, next) {
  if (!isValidInstanceName(req.params.name)) {
    return res.status(400).json({ error: "Invalid instance name" });
  }
  return next();
}

// Docker identifiers (container / network / volume names, image refs) that get
// interpolated into shell-built `docker` commands. Allow the characters Docker
// itself permits in names + image refs (`:` tag, `/` repo, `@` digest, `.` `_`
// `-`) but nothing that can break out of the command: no spaces, `;`, `|`, `&`,
// `$`, backticks, quotes, or newlines.
const DOCKER_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/;
function isDockerRef(s) {
  return typeof s === "string" && s.length > 0 && s.length <= 256 && DOCKER_REF_RE.test(s);
}
// Conservative token for free-form-ish args (flags, profiles, paths, --since
// values, db names, users): printable, no shell metacharacters.
const SAFE_ARG_RE = /^[A-Za-z0-9 _.=:/@,+-]*$/;
function isSafeArg(s) {
  return typeof s === "string" && s.length <= 512 && SAFE_ARG_RE.test(s);
}
// A Postgres database/identifier name.
const PG_IDENT_RE = /^[A-Za-z0-9_-]+$/;
// Escape a string for safe literal use inside a `new RegExp(...)`.
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Atomic file write: write to a temp sibling then rename, so a crash mid-write
// can't leave a truncated/corrupt file. rename(2) is atomic within a filesystem.
function writeFileAtomic(filePath, contents, { mode } = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, contents, "utf-8");
  if (mode != null) { try { chmodSync(tmp, mode); } catch { /* best effort */ } }
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

// ── Reverse-tag protection (2026-04-30 incident guardrail) ──────────────────
// The sandbox-spawn outage was caused by the local matrx-sandbox:* image tags
// being deleted (a stray `docker rmi` / `docker ... prune -a`). These tags are
// expensive to rebuild (~2.9 GB) and the orchestrator 404s without them. Refuse
// any command that would delete a protected image unless the operator opts in
// with MATRX_DESTRUCTIVE_OPS=1. Returns an error-shaped result if blocked, else
// null. Best-effort string analysis — it's a seatbelt, not a sandbox.
const PROTECTED_IMAGE_RE = /matrx-sandbox|matrx-orchestrator/i;
function guardDestructiveImageOp(command) {
  if (process.env.MATRX_DESTRUCTIVE_OPS === "1") return null;
  const cmd = String(command || "");
  const removesByName = /\bdocker\b[^\n]*\b(rmi|image\s+rm|image\s+remove)\b/i.test(cmd) && PROTECTED_IMAGE_RE.test(cmd);
  // `prune -a/--all` removes unused images wholesale — exactly how the tags got
  // stripped — even though the protected name isn't on the command line.
  const prunesAll = /\bdocker\b[^\n]*\b(system|image)\s+prune\b[^\n]*(-a|--all)\b/i.test(cmd);
  if (removesByName || prunesAll) {
    return {
      success: false,
      error:
        "Blocked by reverse-tag protection: this command can delete the " +
        "matrx-sandbox:* / matrx-orchestrator images that sandbox spawning " +
        "depends on (the 2026-04-30 incident). Rebuild via the Manager UI " +
        "instead, or set MATRX_DESTRUCTIVE_OPS=1 to override.",
      blocked: true,
    };
  }
  return null;
}

function textResult(data) {
  return {
    content: [{
      type: "text",
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    }],
  };
}

function resolveHostPath(userPath) {
  const normalized = resolve("/", userPath);
  if (normalized.startsWith("/srv/") || normalized === "/srv") {
    return normalized.replace(/^\/srv/, HOST_SRV);
  }
  if (normalized.startsWith("/data/") || normalized === "/data") {
    return normalized.replace(/^\/data/, HOST_DATA);
  }
  return normalized;
}

function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}

/**
 * Wait for a container to become healthy, then verify Traefik has issued a certificate.
 *
 * IMPORTANT: Traefik's Docker provider filters out unhealthy/starting containers.
 * If a container never becomes healthy, Traefik never creates a router for it,
 * so no Let's Encrypt certificate will ever be requested. The health of the
 * container is the prerequisite — not curling the domain.
 *
 * Flow: container healthy → Traefik detects it → Traefik creates router →
 *       Traefik requests ACME cert → cert issued (usually within 30-60s).
 */
function waitForCertificate(containerName, domain, { maxWaitSec = 120 } = {}) {
  console.log(`🔐 Waiting for certificate: ${domain} (container: ${containerName})`);

  // Phase 1: Wait for the container to become healthy (or have no healthcheck)
  const healthPollInterval = 5; // seconds
  const healthTimeout = Math.min(maxWaitSec, 90);
  let containerHealthy = false;

  for (let elapsed = 0; elapsed < healthTimeout; elapsed += healthPollInterval) {
    const healthResult = exec(`docker inspect ${containerName} --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null`);
    const status = healthResult.output?.trim();

    if (status === "healthy" || status === "none") {
      containerHealthy = true;
      console.log(`  ✓ Container is ${status === "none" ? "running (no healthcheck)" : "healthy"} after ${elapsed}s`);
      break;
    }

    if (status === "unhealthy") {
      // Check container logs for crash reason
      const logs = exec(`docker logs ${containerName} --tail 5 2>&1`);
      console.log(`  ⚠ Container is unhealthy after ${elapsed}s. Last logs:`);
      console.log(`    ${(logs.output || "no output").split("\n").slice(-3).join("\n    ")}`);
    }

    if (elapsed + healthPollInterval < healthTimeout) {
      execSync(`sleep ${healthPollInterval}`, { stdio: "ignore" });
    }
  }

  if (!containerHealthy) {
    console.log(`  ❌ Container did not become healthy within ${healthTimeout}s`);
    console.log(`  → Traefik will NOT create a router for unhealthy containers`);
    console.log(`  → No certificate will be issued until the container is healthy`);
    return {
      success: false,
      error: "Container unhealthy — Traefik skips unhealthy containers, so no cert will be issued",
      container_status: "unhealthy",
    };
  }

  // Phase 2: Wait for Traefik to pick up the container and issue a certificate
  // Traefik re-evaluates on container state changes, then initiates ACME challenge
  console.log(`  Waiting for Traefik to issue certificate (ACME HTTP-01 challenge)...`);
  const certPollInterval = 10; // seconds
  const certTimeout = Math.max(maxWaitSec - healthTimeout, 60);

  for (let elapsed = 0; elapsed < certTimeout; elapsed += certPollInterval) {
    try {
      const issuer = execSync(
        `echo | openssl s_client -connect "${domain}:443" -servername "${domain}" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();

      if (issuer.includes("Let's Encrypt")) {
        console.log(`  ✅ Let's Encrypt certificate issued for ${domain} (${elapsed}s)`);
        return { success: true, issuer };
      }
    } catch {
      // Certificate check failed, keep waiting
    }

    if (elapsed + certPollInterval < certTimeout) {
      execSync(`sleep ${certPollInterval}`, { stdio: "ignore" });
    }
  }

  // Certificate not issued yet — check final state
  try {
    const issuer = execSync(
      `echo | openssl s_client -connect "${domain}:443" -servername "${domain}" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();

    if (issuer.includes("TRAEFIK DEFAULT CERT")) {
      console.log(`  ⚠ Still using Traefik default cert after waiting. ACME challenge may still be in progress.`);
      return { success: false, issuer, warning: "Certificate pending — ACME challenge may still be running" };
    }
    console.log(`  ❓ Unknown certificate state: ${issuer}`);
    return { success: false, issuer, warning: "Unknown certificate status" };
  } catch (error) {
    console.log(`  ❌ Could not check certificate: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  DEPLOYMENT HELPERS (shared by tools + REST API)                           ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function loadDeployments() {
  try {
    return JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf-8"));
  } catch {
    return { defaults: { image: "matrx-ship:latest", source: "/srv/projects/matrx-ship", domain_suffix: DOMAIN_SUFFIX, postgres_image: "postgres:17-alpine" }, instances: {} };
  }
}

function saveDeployments(config) {
  writeFileAtomic(DEPLOYMENTS_FILE, JSON.stringify(config, null, 2) + "\n");
  // Dual-write to Supabase (fire and forget). Log failures so a silently-drifting
  // backup is visible in the Manager logs instead of vanishing.
  syncAllInstances(config).catch((e) => console.error("[supabase] syncAllInstances failed:", e?.message || e));
}

function generateCompose(name, config) {
  const pgImage = config.defaults?.postgres_image || "postgres:17-alpine";
  return `# Auto-generated for ship instance: ${name}
# Do not edit manually — managed by matrx-manager
services:
  app:
    image: matrx-ship:latest
    container_name: ${name}
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://ship:\${POSTGRES_PASSWORD}@db:5432/ship
      MATRX_SHIP_API_KEY: \${MATRX_SHIP_API_KEY:-}
      MATRX_SHIP_ADMIN_SECRET: \${MATRX_SHIP_ADMIN_SECRET:-}
      SUPABASE_MATRIX_JWT_SECRET: \${SUPABASE_MATRIX_JWT_SECRET:-}
      SUPABASE_MATRIX_URL: \${SUPABASE_MATRIX_URL:-}
      SUPABASE_MATRIX_KEY: \${SUPABASE_MATRIX_KEY:-}
      MATRX_AIDREAM_URL: \${MATRX_AIDREAM_URL:-}
      PROJECT_NAME: \${PROJECT_NAME}
      VERCEL_ACCESS_TOKEN: \${VERCEL_ACCESS_TOKEN:-}
      VERCEL_PROJECT_ID: \${VERCEL_PROJECT_ID:-}
      VERCEL_TEAM_ID: \${VERCEL_TEAM_ID:-}
      VERCEL_WEBHOOK_SECRET: \${VERCEL_WEBHOOK_SECRET:-}
      GITHUB_WEBHOOK_SECRET: \${GITHUB_WEBHOOK_SECRET:-}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - internal
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${name}.rule=Host(\`${name}.${DOMAIN_SUFFIX}\`)"
      - "traefik.http.routers.${name}.entrypoints=websecure"
      - "traefik.http.routers.${name}.tls.certresolver=letsencrypt"
      - "traefik.http.routers.${name}.middlewares=security-headers@file"
      - "traefik.http.services.${name}.loadbalancer.server.port=3000"
      - "traefik.docker.network=proxy"

  db:
    image: ${pgImage}
    container_name: db-${name}
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ship
      POSTGRES_USER: ship
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ship"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - internal

volumes:
  pgdata:

networks:
  internal:
    driver: bridge
  proxy:
    external: true
`;
}

function generateEnv(name, displayName, dbPassword, apiKey) {
  return `# Instance: ${name}
# Generated: ${new Date().toISOString()}

POSTGRES_PASSWORD=${dbPassword}
PROJECT_NAME=${displayName}
MATRX_SHIP_API_KEY=${apiKey}
MATRX_SHIP_ADMIN_SECRET=

# Admin OAuth (AI Matrx / Supabase). All three SUPABASE_MATRIX_* are required to
# enable OAuth login for /admin; MATRX_SHIP_ADMIN_SECRET remains as break-glass.
SUPABASE_MATRIX_JWT_SECRET=
SUPABASE_MATRIX_URL=
SUPABASE_MATRIX_KEY=
MATRX_AIDREAM_URL=

# Vercel integration (optional)
VERCEL_ACCESS_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
VERCEL_WEBHOOK_SECRET=

# GitHub integration (optional)
GITHUB_WEBHOOK_SECRET=
`;
}

function createInstance(name, display_name, api_key, postgres_image) {
  if (!isValidInstanceName(name)) return { error: "Invalid instance name" };
  // The postgres_image is interpolated into the generated docker-compose.yml; a
  // value with newlines/colons could inject extra YAML. Restrict to image refs.
  if (postgres_image != null && !isDockerRef(postgres_image)) {
    return { error: "Invalid postgres_image (must be a valid image reference)" };
  }
  const config = loadDeployments();

  if (config.instances[name]) {
    return { error: `Instance '${name}' already exists.` };
  }
  const nameCheck = exec(`docker ps -a --format '{{.Names}}' | grep -E '^(${name}|db-${name})$'`);
  if (nameCheck.success && nameCheck.output) {
    return { error: `Container ${name} or db-${name} already exists.` };
  }
  // Guard against silent data loss: if a prior instance of this name was deleted
  // WITHOUT removing its data volume, recreating reuses the stale Postgres volume
  // — which still holds the OLD password — and the freshly generated password
  // below would never authenticate. Refuse rather than create a broken instance.
  const volCheck = exec(`docker volume ls --format '{{.Name}}' | grep -E '(^|_)${name}_pgdata$'`);
  if (volCheck.success && volCheck.output) {
    return { error: `A Postgres data volume for '${name}' still exists (likely from a prior instance deleted without its data). Remove it (docker volume rm ${name}_pgdata) or pick a different name before recreating.` };
  }

  const dbPassword = randomHex(16);
  const finalApiKey = api_key || `sk_ship_${randomHex(16)}`;

  const instanceDir = join(APPS_DIR, name);
  mkdirSync(instanceDir, { recursive: true });

  const composeOverride = postgres_image
    ? { ...config, defaults: { ...config.defaults, postgres_image } }
    : config;
  writeFileSync(join(instanceDir, "docker-compose.yml"), generateCompose(name, composeOverride), "utf-8");
  writeFileSync(join(instanceDir, ".env"), generateEnv(name, display_name, dbPassword, finalApiKey), "utf-8");
  exec(`chmod 600 ${join(instanceDir, ".env")}`);

  config.instances[name] = {
    display_name,
    subdomain: `${name}`,
    url: `https://${name}.${DOMAIN_SUFFIX}`,
    api_key: finalApiKey,
    db_password: dbPassword,
    postgres_image: postgres_image || config.defaults?.postgres_image || "postgres:17-alpine",
    created_at: new Date().toISOString(),
    status: "created",
  };
  saveDeployments(config);

  const startResult = exec("docker compose up -d", { cwd: instanceDir, timeout: 120000 });
  if (startResult.success) {
    config.instances[name].status = "running";
    saveDeployments(config);

    // Wait for container health + Let's Encrypt certificate
    const certResult = waitForCertificate(name, `${name}.${DOMAIN_SUFFIX}`);
    config.instances[name].certificate_status = certResult.success ? "issued" : (certResult.container_status === "unhealthy" ? "blocked-unhealthy" : "pending");
    saveDeployments(config);
  }

  // Audit log
  auditLog("api", "instance_create", name, { display_name, success: startResult.success });

  return {
    success: startResult.success,
    instance: name,
    url: `https://${name}.${DOMAIN_SUFFIX}`,
    admin_url: `https://${name}.${DOMAIN_SUFFIX}/admin`,
    api_key: finalApiKey,
    containers: { app: `${name}`, db: `db-${name}` },
    directory: `/srv/apps/${name}/`,
    compose_output: startResult.output || startResult.error,
    note: "First boot takes ~30s for migrations and seeding. Certificate request initiated.",
  };
}

function listInstances() {
  const config = loadDeployments();
  const instances = [];
  for (const [name, info] of Object.entries(config.instances)) {
    const appStatus = exec(`docker inspect ${name} --format '{{.State.Status}}' 2>/dev/null`);
    const dbStatus = exec(`docker inspect db-${name} --format '{{.State.Status}}' 2>/dev/null`);
    instances.push({
      name,
      display_name: info.display_name,
      url: info.url,
      admin_url: `${info.url}/admin`,
      api_key: info.api_key,
      app_container: appStatus.success ? appStatus.output : "not found",
      db_container: dbStatus.success ? dbStatus.output : "not found",
      created_at: info.created_at,
      directory: `/srv/apps/${name}/`,
    });
  }
  return { instances, count: instances.length, image: config.defaults?.image || "matrx-ship:latest" };
}

function removeInstance(name, delete_data, force = false) {
  const config = loadDeployments();
  if (!config.instances[name]) return { error: `Instance '${name}' not found` };

  const instanceDir = join(APPS_DIR, name);
  const results = {};

  // Try docker compose down first
  if (existsSync(join(instanceDir, "docker-compose.yml"))) {
    const downFlags = delete_data ? "down -v --remove-orphans" : "down --remove-orphans";
    results.compose_down = exec(`docker compose ${downFlags}`, { cwd: instanceDir, timeout: 60000 });

    // If compose down failed and force is enabled, try manual cleanup
    if (!results.compose_down.success && force) {
      results.force_cleanup = {
        app: exec(`docker rm -f ${name} 2>/dev/null`),
        db: exec(`docker rm -f db-${name} 2>/dev/null`),
      };
      if (delete_data) {
        results.force_cleanup.volume = exec(`docker volume rm ${name}_pgdata 2>/dev/null`);
      }
    }
  } else {
    // No compose file, remove containers directly
    results.direct_removal = {
      app: exec(`docker rm -f ${name} 2>/dev/null`),
      db: exec(`docker rm -f db-${name} 2>/dev/null`),
    };
    if (delete_data) {
      results.direct_removal.volume = exec(`docker volume rm ${name}_pgdata 2>/dev/null`);
    }
  }

  // Delete directory if requested
  if (delete_data) {
    results.directory_deleted = exec(`rm -rf ${instanceDir}`);
  }

  // Remove from config
  delete config.instances[name];
  saveDeployments(config);
  removeInstanceFromSupabase(name).catch(() => { });

  // Audit log
  auditLog("api", "instance_remove", name, { delete_data, force });

  const success = results.compose_down?.success || results.force_cleanup || results.direct_removal;
  return {
    success: !!success,
    removed: name,
    data_deleted: delete_data || false,
    forced: force,
    results
  };
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  BUILD HISTORY                                                            ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function loadBuildHistory() {
  try {
    return JSON.parse(readFileSync(BUILD_HISTORY_FILE, "utf-8"));
  } catch {
    return { builds: [] };
  }
}

function saveBuildHistory(history) {
  writeFileAtomic(BUILD_HISTORY_FILE, JSON.stringify(history, null, 2) + "\n");
}

function recordBuild(entry) {
  const history = loadBuildHistory();
  history.builds.unshift(entry); // newest first
  saveBuildHistory(history);
  // Dual-write to Supabase (fire and forget)
  recordBuildInSupabase(entry).catch(() => { });
}

function generateBuildTag() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  REBUILD HELPERS (shared by tools + REST API)                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function rebuildInstances({ name, skip_build, triggered_by } = {}) {
  const config = loadDeployments();
  const results = {};
  const started_at = new Date().toISOString();
  const buildTag = generateBuildTag();
  const src = resolveHostPath(config.defaults?.source || "/srv/projects/matrx-ship");

  // Capture git info from source
  const gitCommit = exec(`git -C ${src} rev-parse --short HEAD`);
  const gitLog = exec(`git -C ${src} log -1 --pretty=format:"%s"`);

  // Step 1: Build the Docker image (unless skipped)
  let imageId = null;
  if (!skip_build) {
    // Tag the current latest as :rollback before building (safety net)
    exec("docker tag matrx-ship:latest matrx-ship:rollback 2>/dev/null");

    // Build with both :latest and :timestamp tags
    results.build = exec(`docker buildx build --load -t matrx-ship:latest -t matrx-ship:${buildTag} ${src}`, { timeout: 600000 });
    if (!results.build.success) {
      // Record failed build
      recordBuild({
        id: `bld_${randomHex(6)}`,
        tag: buildTag,
        timestamp: started_at,
        git_commit: gitCommit.output || "unknown",
        git_message: gitLog.output || "unknown",
        image_id: null,
        success: false,
        error: results.build.error,
        duration_ms: Date.now() - new Date(started_at).getTime(),
        triggered_by: triggered_by || "unknown",
        instances_restarted: [],
      });
      return { success: false, step: "build", error: results.build.error, started_at, finished_at: new Date().toISOString() };
    }

    // Get the image ID
    const imgInspect = exec("docker inspect matrx-ship:latest --format '{{.Id}}'");
    imageId = imgInspect.output?.replace("sha256:", "").substring(0, 12) || null;
  }

  // Step 2: Restart target instances
  const targets = name ? [name] : Object.keys(config.instances);
  results.restarts = {};
  results.certificates = {};
  for (const t of targets) {
    if (!config.instances[t]) { results.restarts[t] = { error: "not found" }; continue; }
    results.restarts[t] = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });

    // Wait for container health + certificate after restart
    if (results.restarts[t].success) {
      results.certificates[t] = waitForCertificate(t, `${t}.${DOMAIN_SUFFIX}`, { maxWaitSec: 90 });
    }
  }

  const finished_at = new Date().toISOString();

  // Record successful build
  if (!skip_build) {
    recordBuild({
      id: `bld_${randomHex(6)}`,
      tag: buildTag,
      timestamp: started_at,
      git_commit: gitCommit.output || "unknown",
      git_message: gitLog.output || "unknown",
      image_id: imageId,
      success: true,
      error: null,
      duration_ms: Date.now() - new Date(started_at).getTime(),
      triggered_by: triggered_by || "unknown",
      instances_restarted: targets,
    });

    // Run retention cleanup in background
    try { cleanupBuildImages(); } catch { /* non-fatal */ }
  }

  return {
    success: true,
    image_rebuilt: !skip_build,
    build_tag: skip_build ? null : buildTag,
    image_id: imageId,
    instances_restarted: targets,
    started_at,
    finished_at,
    results,
  };
}

function selfRebuild() {
  const started_at = new Date().toISOString();
  const smDir = join(HOST_SRV, "apps", "server-manager");

  if (!existsSync(join(smDir, "docker-compose.yml"))) {
    return { success: false, error: "docker-compose.yml not found in /srv/apps/server-manager/", started_at };
  }

  // Rebuild and restart only the server-manager service
  const result = exec("docker compose up -d --build server-manager", { cwd: smDir, timeout: 300000 });

  return {
    success: result.success,
    started_at,
    finished_at: new Date().toISOString(),
    output: result.output || result.error,
    note: result.success
      ? "Server manager is rebuilding. This container will restart — you may lose connection briefly."
      : "Self-rebuild failed. Check the output for details.",
  };
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  BUILD INFO / HISTORY / ROLLBACK / CLEANUP                                ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function getBuildInfo() {
  const config = loadDeployments();
  const src = resolveHostPath(config.defaults?.source || "/srv/projects/matrx-ship");

  // Current image info
  const imgInspect = exec("docker inspect matrx-ship:latest --format '{{.Id}} {{.Created}}' 2>/dev/null");
  let currentImage = { id: null, created: null, age: null };
  if (imgInspect.success && imgInspect.output) {
    const parts = imgInspect.output.split(" ");
    const id = parts[0]?.replace("sha256:", "").substring(0, 12);
    const created = parts.slice(1).join(" ");
    const ageMs = created ? Date.now() - new Date(created).getTime() : 0;
    const ageHours = Math.floor(ageMs / 3600000);
    currentImage = { id, created, age: ageHours < 24 ? `${ageHours}h` : `${Math.floor(ageHours / 24)}d ${ageHours % 24}h` };
  }

  // Git info from source
  const gitCommit = exec(`git -C ${src} rev-parse --short HEAD`);
  const gitBranch = exec(`git -C ${src} rev-parse --abbrev-ref HEAD`);

  // Find what commit the current image was built from (from build history)
  const history = loadBuildHistory();
  const lastSuccessful = history.builds.find((b) => b.success);
  const lastBuildCommit = lastSuccessful?.git_commit || null;

  // Pending changes since last build
  let pendingCommits = [];
  let diffStats = null;
  if (lastBuildCommit && gitCommit.output && lastBuildCommit !== gitCommit.output) {
    const logResult = exec(`git -C ${src} log --oneline ${lastBuildCommit}..HEAD 2>/dev/null`);
    if (logResult.success && logResult.output) {
      pendingCommits = logResult.output.split("\n").filter(Boolean);
    }
    const statResult = exec(`git -C ${src} diff --stat ${lastBuildCommit}..HEAD 2>/dev/null`);
    if (statResult.success) diffStats = statResult.output;
  } else if (!lastBuildCommit) {
    // No previous build — show recent commits
    const logResult = exec(`git -C ${src} log --oneline -10 2>/dev/null`);
    if (logResult.success && logResult.output) {
      pendingCommits = logResult.output.split("\n").filter(Boolean);
    }
  }

  // Instances info
  const instances = Object.entries(config.instances).map(([n, info]) => {
    const status = exec(`docker inspect ${n} --format '{{.State.Status}}' 2>/dev/null`);
    return { name: n, display_name: info.display_name, status: status.output || "not found" };
  });

  // Available image tags
  const tagsResult = exec("docker images matrx-ship --format '{{.Tag}} {{.ID}} {{.CreatedSince}}' 2>/dev/null");
  const availableTags = [];
  if (tagsResult.success && tagsResult.output) {
    for (const line of tagsResult.output.split("\n").filter(Boolean)) {
      const parts = line.split(/\s+/);
      const tag = parts[0];
      if (tag && tag !== "<none>") availableTags.push({ tag, id: parts[1], age: parts.slice(2).join(" ") });
    }
  }

  return {
    current_image: currentImage,
    source: {
      path: config.defaults?.source || "/srv/projects/matrx-ship",
      branch: gitBranch.output || "unknown",
      head_commit: gitCommit.output || "unknown",
      last_build_commit: lastBuildCommit,
    },
    has_changes: pendingCommits.length > 0,
    pending_commits: pendingCommits,
    diff_stats: diffStats,
    instances,
    available_tags: availableTags,
    last_build: lastSuccessful || null,
  };
}

function getBuildHistory({ limit, include_failed } = {}) {
  const history = loadBuildHistory();
  let builds = history.builds;
  if (!include_failed) builds = builds.filter((b) => b.success);
  if (limit) builds = builds.slice(0, limit);
  return { builds, total: history.builds.length };
}

function rollbackBuild(tag) {
  if (!tag) return { success: false, error: "tag is required" };

  // Check the tag exists
  const check = exec(`docker inspect matrx-ship:${tag} --format '{{.Id}}' 2>/dev/null`);
  if (!check.success) return { success: false, error: `Image tag matrx-ship:${tag} not found` };

  // Tag current latest as :pre-rollback for safety
  exec("docker tag matrx-ship:latest matrx-ship:pre-rollback 2>/dev/null");

  // Re-tag the target as :latest
  const retag = exec(`docker tag matrx-ship:${tag} matrx-ship:latest`);
  if (!retag.success) return { success: false, error: `Failed to retag: ${retag.error}` };

  // Restart all instances
  const config = loadDeployments();
  const targets = Object.keys(config.instances);
  const restarts = {};
  for (const t of targets) {
    restarts[t] = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });
  }

  // Record rollback in build history
  recordBuild({
    id: `bld_${randomHex(6)}`,
    tag: `rollback-to-${tag}`,
    timestamp: new Date().toISOString(),
    git_commit: "rollback",
    git_message: `Rollback to image tag: ${tag}`,
    image_id: check.output?.replace("sha256:", "").substring(0, 12) || null,
    success: true,
    error: null,
    duration_ms: 0,
    triggered_by: "rollback",
    instances_restarted: targets,
  });

  return {
    success: true,
    rolled_back_to: tag,
    image_id: check.output?.replace("sha256:", "").substring(0, 12) || null,
    instances_restarted: targets,
    restarts,
    note: "Previous latest saved as matrx-ship:pre-rollback",
  };
}

function cleanupBuildImages() {
  const history = loadBuildHistory();
  const successfulBuilds = history.builds.filter((b) => b.success && b.tag && !b.tag.startsWith("rollback"));

  // Retention policy:
  // - Keep the last 3 builds always
  // - Keep 1 per week for last 4 weeks
  // - Keep 1 per month for last 3 months
  // - Remove everything else

  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;
  const tagsToKeep = new Set(["latest", "rollback", "pre-rollback"]);

  // Always keep last 3
  for (const b of successfulBuilds.slice(0, 3)) {
    tagsToKeep.add(b.tag);
  }

  // Keep 1 per week for last 4 weeks
  for (let w = 0; w < 4; w++) {
    const weekStart = now - (w + 1) * ONE_WEEK;
    const weekEnd = now - w * ONE_WEEK;
    const weekBuild = successfulBuilds.find((b) => {
      const t = new Date(b.timestamp).getTime();
      return t >= weekStart && t < weekEnd;
    });
    if (weekBuild) tagsToKeep.add(weekBuild.tag);
  }

  // Keep 1 per month for last 3 months
  for (let m = 0; m < 3; m++) {
    const monthStart = now - (m + 1) * ONE_MONTH;
    const monthEnd = now - m * ONE_MONTH;
    const monthBuild = successfulBuilds.find((b) => {
      const t = new Date(b.timestamp).getTime();
      return t >= monthStart && t < monthEnd;
    });
    if (monthBuild) tagsToKeep.add(monthBuild.tag);
  }

  // Get all existing image tags
  const allTagsResult = exec("docker images matrx-ship --format '{{.Tag}}' 2>/dev/null");
  const allTags = allTagsResult.success ? allTagsResult.output.split("\n").filter(Boolean) : [];

  // Remove tags not in keep set
  const removed = [];
  for (const tag of allTags) {
    if (tag === "<none>" || tagsToKeep.has(tag)) continue;
    const rm = exec(`docker rmi matrx-ship:${tag} 2>/dev/null`);
    if (rm.success) removed.push(tag);
  }

  return {
    kept: [...tagsToKeep].filter((t) => allTags.includes(t)),
    removed,
    total_tags_before: allTags.length,
    total_tags_after: allTags.length - removed.length,
  };
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  AWS S3 INTEGRATION (requires AWS_ACCESS_KEY_ID + S3_BACKUP_BUCKET env)   ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function isS3Configured() {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.S3_BACKUP_BUCKET);
}

function s3Upload(localPath, s3Key) {
  if (!isS3Configured()) return { success: false, error: "AWS S3 not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION, and S3_BACKUP_BUCKET." };
  const bucket = process.env.S3_BACKUP_BUCKET;
  const result = exec(`aws s3 cp "${localPath}" "s3://${bucket}/${s3Key}"`, { timeout: 600000 });
  return { success: result.success, key: `s3://${bucket}/${s3Key}`, output: result.output || result.error };
}

function s3UploadImageTag(tag) {
  if (!isS3Configured()) return { success: false, error: "AWS S3 not configured" };
  const bucket = process.env.S3_BACKUP_BUCKET;
  const result = exec(`docker save matrx-ship:${tag} | gzip | aws s3 cp - "s3://${bucket}/images/${tag}.tar.gz"`, { timeout: 600000 });
  return { success: result.success, key: `s3://${bucket}/images/${tag}.tar.gz`, output: result.output || result.error };
}

function s3UploadBackup(instanceName, backupFile) {
  if (!isS3Configured()) return { success: false, error: "AWS S3 not configured" };
  // Reject path traversal in either component before they become an S3 key.
  if (!isValidInstanceName(instanceName)) return { success: false, error: "Invalid instance name" };
  if (!/^[A-Za-z0-9_.-]+$/.test(backupFile)) return { success: false, error: "Invalid backup file name" };
  const localPath = join(APPS_DIR, "backups", instanceName, backupFile);
  if (!existsSync(localPath)) return { success: false, error: `Backup file not found: ${localPath}` };
  return s3Upload(localPath, `db-backups/${instanceName}/${backupFile}`);
}

function s3ListBackups() {
  if (!isS3Configured()) return { success: false, error: "AWS S3 not configured" };
  const bucket = process.env.S3_BACKUP_BUCKET;
  const result = exec(`aws s3 ls "s3://${bucket}/" --recursive --human-readable`, { timeout: 30000 });
  return { success: result.success, files: result.output || "", error: result.error };
}

function getSystemInfo() {
  const disk = exec("df -h / | tail -1 | awk '{print $2, $3, $4, $5}'");
  const diskParts = disk.output?.split(" ") || [];
  const dockerInfo = exec("docker info --format '{{.ContainersRunning}} running, {{.ContainersPaused}} paused, {{.ContainersStopped}} stopped, {{.Images}} images'");
  const containerList = exec("docker ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}'");
  const load = exec("cat /proc/loadavg 2>/dev/null || uptime");
  return {
    hostname: hostname(),
    cpus: cpus().length,
    cpu_model: cpus()[0]?.model || "unknown",
    memory: {
      total: formatBytes(totalmem()),
      free: formatBytes(freemem()),
      used: formatBytes(totalmem() - freemem()),
      percent: ((1 - freemem() / totalmem()) * 100).toFixed(1) + "%",
    },
    disk: { total: diskParts[0] || "?", used: diskParts[1] || "?", available: diskParts[2] || "?", percent: diskParts[3] || "?" },
    uptime_hours: (osUptime() / 3600).toFixed(1),
    load_average: load.output,
    docker: dockerInfo.output,
    containers: containerList.output?.split("\n").filter(Boolean) || [],
  };
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  MCP PROTOCOL SERVER (tools + resources)                                   ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function createServer(ctx = {}) {
  const server = new McpServer(
    { name: "matrx-server-manager", version: "2.0.0" },
    { capabilities: { logging: {} } }
  );

  // Per-tool authorization. The HTTP routes gate destructive actions with
  // requireRole(...), but the /mcp endpoint historically applied only
  // authMiddleware — so ANY valid token (even a read-only `viewer`) could invoke
  // shell_exec / app_remove / file_write. `ctx.role` is the caller's token role
  // ("admin" | "deployer" | "viewer"), `ctx.isSuperadmin` mirrors the HTTP flag.
  // Returns an error result if the caller lacks the role, else null. When auth is
  // disabled (no role at all) it allows, matching requireRole's dev behavior.
  const callerRole = ctx.role || null;
  const callerSuper = !!ctx.isSuperadmin;
  function gate(...allowed) {
    if (!callerRole) return null;        // auth disabled (dev) → open, like requireRole
    if (callerSuper) return null;        // operator-admin / super_admin → all tools
    if (allowed.includes(callerRole)) return null;
    return textResult({ error: `Forbidden — this tool requires role: ${allowed.join(" or ")}` });
  }

  // ── SHELL TOOLS ─────────────────────────────────────────────────────────
  server.tool("shell_exec",
    "Execute a shell command on the server. Has access to Docker CLI, host /srv and /data directories.",
    { command: z.string(), working_directory: z.string().optional(), timeout_ms: z.number().optional() },
    async ({ command, working_directory, timeout_ms }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      const blocked = guardDestructiveImageOp(command);
      if (blocked) return textResult(blocked);
      const timeout = Math.min(timeout_ms || 30000, 120000);
      const cwd = working_directory ? resolveHostPath(working_directory) : HOST_SRV;
      return textResult(exec(command, { timeout, cwd }));
    }
  );

  server.tool("host_exec",
    "Run a shell command on a remote FLEET EC2 host via AWS SSM (NOT this /srv host — use shell_exec for /srv). `host` is a fleet key like 'matrx-sandbox-host-dev' or 'matrx-python-server'. Returns {status, stdout, stderr, exitCode}. An AccessDenied means the box's EC2 IAM role lacks that permission, not a Manager bug.",
    { host: z.string(), command: z.string(), timeout_s: z.number().optional() },
    async ({ host, command, timeout_s }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      const h = FLEET_HOSTS[host];
      if (!h) return textResult({ success: false, error: `Unknown host '${host}'. Known: ${Object.keys(FLEET_HOSTS).join(", ")}` });
      if (!awsConfigured()) return textResult({ success: false, error: "AWS not configured on the Manager (MATRX_ADMIN_AWS_* unset)" });
      try {
        const result = await ssmRun(h.instanceId, command, { timeout: Math.min(timeout_s || 120, 600), comment: "mcp:host_exec" });
        try { auditLog("mcp", "host_exec", host, { command: command.slice(0, 500), status: result.status, exitCode: result.exitCode }); } catch { /* */ }
        return textResult(result);
      } catch (e) {
        return textResult({ success: false, error: `SSM error: ${e.message}` });
      }
    }
  );

  // ── DOCKER TOOLS ────────────────────────────────────────────────────────
  server.tool("docker_ps", "List Docker containers.", { all: z.boolean().optional() },
    async ({ all }) => {
      const flag = all ? "-a" : "";
      const result = exec(`docker ps ${flag} --format '{"name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}","id":"{{.ID}}"}'`);
      if (!result.success) return textResult(result);
      try {
        const containers = result.output.split("\n").filter(Boolean).map((l) => JSON.parse(l));
        return textResult({ containers, count: containers.length });
      } catch { return textResult(result.output); }
    }
  );

  server.tool("docker_logs", "Get logs from a Docker container.",
    { container: z.string(), tail: z.number().optional(), since: z.string().optional() },
    async ({ container, tail, since }) => {
      if (!isDockerRef(container)) return textResult({ error: "Invalid container name" });
      if (since != null && !isSafeArg(since)) return textResult({ error: "Invalid 'since' value" });
      const n = Math.min(Math.max(parseInt(tail, 10) || 100, 1), 100000);
      let cmd = `docker logs ${container} --tail ${n}`;
      if (since) cmd += ` --since ${since}`;
      return textResult(exec(cmd + " 2>&1"));
    }
  );

  server.tool("docker_inspect", "Inspect a Docker container, image, network, or volume.",
    { target: z.string(), type: z.enum(["container", "image", "network", "volume"]).optional() },
    async ({ target, type }) => {
      if (!isDockerRef(target)) return textResult({ error: "Invalid target name" });
      const cmd = type === "network" ? `docker network inspect ${target}` : type === "image" ? `docker image inspect ${target}` : type === "volume" ? `docker volume inspect ${target}` : `docker inspect ${target}`;
      const result = exec(cmd);
      if (!result.success) return textResult(result);
      try { return textResult(JSON.parse(result.output)); } catch { return textResult(result.output); }
    }
  );

  server.tool("docker_manage", "Start, stop, restart, or remove a Docker container.",
    { container: z.string(), action: z.enum(["start", "stop", "restart", "remove"]), force: z.boolean().optional() },
    async ({ container, action, force }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      if (!isDockerRef(container)) return textResult({ error: "Invalid container name" });
      const cmds = { start: `docker start ${container}`, stop: `docker stop ${container}`, restart: `docker restart ${container}`, remove: `docker rm ${force ? "-f" : ""} ${container}` };
      return textResult(exec(cmds[action]));
    }
  );

  server.tool("docker_exec", "Execute a command inside a running Docker container.",
    { container: z.string(), command: z.string(), user: z.string().optional(), working_dir: z.string().optional() },
    async ({ container, command, user, working_dir }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      if (!isDockerRef(container)) return textResult({ error: "Invalid container name" });
      if (user != null && !isSafeArg(user)) return textResult({ error: "Invalid user" });
      if (working_dir != null && !isSafeArg(working_dir)) return textResult({ error: "Invalid working_dir" });
      // argv form: only `command` is interpreted by the inner shell; the docker
      // wrapper and its flags are passed as separate process arguments so a
      // crafted container/user/working_dir can't break out.
      const args = ["exec"];
      if (user) args.push("-u", user);
      if (working_dir) args.push("-w", working_dir);
      args.push(container, "sh", "-c", command);
      try {
        const out = execFileSync("docker", args, { encoding: "utf-8", timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
        return textResult({ success: true, output: out.trim() });
      } catch (e) {
        return textResult({ success: false, output: e.stdout?.trim() || "", error: e.stderr?.trim() || e.message });
      }
    }
  );

  server.tool("docker_compose", "Run docker compose commands for a stack.",
    { stack: z.string(), action: z.enum(["up", "down", "restart", "pull", "build", "ps", "logs", "config"]), services: z.array(z.string()).optional(), profile: z.string().optional(), flags: z.string().optional() },
    async ({ stack, action, services, profile, flags }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      if (!isSafeArg(stack) || stack.includes("..")) return textResult({ error: "Invalid stack" });
      if (profile != null && !isSafeArg(profile)) return textResult({ error: "Invalid profile" });
      if (flags != null && !isSafeArg(flags)) return textResult({ error: "Invalid flags — shell metacharacters are not allowed" });
      if (services?.some((s) => !isDockerRef(s))) return textResult({ error: "Invalid service name" });
      const stackDir = join(HOST_SRV, stack);
      if (!existsSync(join(stackDir, "docker-compose.yml"))) return textResult({ error: `No docker-compose.yml in /srv/${stack}/` });
      let cmd = "docker compose";
      if (profile) cmd += ` --profile ${profile}`;
      cmd += ` ${action}`;
      if (action === "up") cmd += " -d";
      if (action === "logs") cmd += " --tail 50";
      if (flags) cmd += ` ${flags}`;
      if (services?.length) cmd += ` ${services.join(" ")}`;
      return textResult(exec(cmd, { cwd: stackDir, timeout: 120000 }));
    }
  );

  server.tool("docker_networks", "List Docker networks with connected containers.", {},
    async () => textResult(exec(`docker network ls --format '{{.Name}}\t{{.Driver}}\t{{.Scope}}' && echo "---" && docker network ls -q | xargs -I{} sh -c 'echo "NET:$(docker network inspect {} --format "{{.Name}}")"; docker network inspect {} --format "{{range .Containers}}  {{.Name}}{{end}}"'`))
  );

  server.tool("docker_images", "List Docker images.", { filter: z.string().optional() },
    async ({ filter }) => {
      let cmd = `docker images --format '{"repository":"{{.Repository}}","tag":"{{.Tag}}","size":"{{.Size}}","created":"{{.CreatedSince}}","id":"{{.ID}}"}'`;
      if (filter) cmd += ` "${filter}"`;
      const result = exec(cmd);
      if (!result.success) return textResult(result);
      try { return textResult({ images: result.output.split("\n").filter(Boolean).map((l) => JSON.parse(l)) }); } catch { return textResult(result.output); }
    }
  );

  // ── FILE TOOLS ──────────────────────────────────────────────────────────
  server.tool("file_read", "Read a file from the server.",
    { path: z.string(), offset: z.number().optional(), limit: z.number().optional() },
    async ({ path, offset, limit }) => {
      try {
        const realPath = resolveHostPath(path);
        let content = readFileSync(realPath, "utf-8");
        if (offset || limit) { const lines = content.split("\n"); content = lines.slice((offset || 1) - 1, limit ? (offset || 1) - 1 + limit : lines.length).join("\n"); }
        return textResult({ path, content, size: statSync(realPath).size });
      } catch (e) { return textResult({ error: e.message, path }); }
    }
  );

  server.tool("file_write", "Write content to a file on the server.",
    { path: z.string(), content: z.string(), append: z.boolean().optional(), create_parents: z.boolean().optional() },
    async ({ path, content, append, create_parents }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      try {
        const realPath = resolveHostPath(path);
        if (create_parents !== false) mkdirSync(dirname(realPath), { recursive: true });
        if (append) { const existing = existsSync(realPath) ? readFileSync(realPath, "utf-8") : ""; writeFileSync(realPath, existing + content, "utf-8"); }
        else writeFileSync(realPath, content, "utf-8");
        return textResult({ success: true, path, bytes: Buffer.byteLength(content) });
      } catch (e) { return textResult({ error: e.message, path }); }
    }
  );

  server.tool("file_list", "List files and directories.",
    { path: z.string(), recursive: z.boolean().optional() },
    async ({ path, recursive }) => {
      try {
        const realPath = resolveHostPath(path);
        function listDir(dirPath, depth = 0) {
          return readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
            const full = join(dirPath, entry.name);
            const info = { name: entry.name, type: entry.isDirectory() ? "directory" : "file" };
            if (entry.isFile()) try { info.size = statSync(full).size; } catch { }
            if (recursive && entry.isDirectory() && depth < 3) try { info.children = listDir(full, depth + 1); } catch { }
            return info;
          });
        }
        return textResult({ path, entries: listDir(realPath) });
      } catch (e) { return textResult({ error: e.message, path }); }
    }
  );

  server.tool("file_delete", "Delete a file.", { path: z.string() },
    async ({ path }) => { const g = gate("admin", "deployer"); if (g) return g; try { unlinkSync(resolveHostPath(path)); return textResult({ success: true, path }); } catch (e) { return textResult({ error: e.message, path }); } }
  );

  // ── SYSTEM TOOLS ────────────────────────────────────────────────────────
  server.tool("system_info", "Get system information.", {}, async () => textResult(getSystemInfo()));

  server.tool("system_processes", "List top processes.",
    { sort_by: z.enum(["cpu", "memory"]).optional(), count: z.number().optional() },
    async ({ sort_by, count }) => textResult(exec(`ps aux ${sort_by === "memory" ? "--sort=-%mem" : "--sort=-%cpu"} | head -${(count || 15) + 1}`))
  );

  server.tool("system_network", "Show listening ports.", {},
    async () => textResult({ listening_ports: exec("ss -tlnp").output, active_connections: exec("ss -tnp | head -30").output })
  );

  server.tool("system_firewall", "Check UFW status.", {},
    async () => textResult(exec("ufw status verbose 2>/dev/null || echo 'UFW not available in container'"))
  );

  // ── TRAEFIK TOOLS ───────────────────────────────────────────────────────
  server.tool("traefik_routes", "List Traefik HTTP routers.", {},
    async () => {
      const result = exec(`docker ps --format '{{.Names}}' | xargs -I{} sh -c 'echo "=== {} ===" && docker inspect {} --format "{{json .Config.Labels}}"' 2>/dev/null`);
      if (!result.success) return textResult(result);
      const routes = [];
      for (const block of result.output.split("=== ").filter(Boolean)) {
        const lines = block.split("\n"); const name = lines[0]?.replace(" ===", "").trim();
        try {
          const labels = JSON.parse(lines.slice(1).join(""));
          const routerEntries = Object.entries(labels).filter(([k]) => k.startsWith("traefik.http.routers."));
          if (routerEntries.length > 0) {
            const r = { container: name };
            for (const [k, v] of routerEntries) r[k.replace("traefik.http.routers.", "")] = v;
            for (const [k, v] of Object.entries(labels).filter(([k]) => k.startsWith("traefik.http.services."))) r[k.replace("traefik.http.services.", "")] = v;
            routes.push(r);
          }
        } catch { }
      }
      return textResult({ routes, count: routes.length });
    }
  );

  // ── DATABASE TOOLS ──────────────────────────────────────────────────────
  server.tool("postgres_query", "Execute a read-only SQL query.",
    { query: z.string(), database: z.string().optional() },
    async ({ query, database }) => {
      const trimmed = query.trim().toUpperCase();
      if (!["SELECT", "SHOW", "EXPLAIN", "\\D"].some((p) => trimmed.startsWith(p)))
        return textResult({ error: "Only read-only queries allowed." });
      const db = database || "matrx";
      if (!PG_IDENT_RE.test(db)) return textResult({ error: "Invalid database name" });
      // argv form: the query is a single `-c` argument, never concatenated into
      // a shell string, so it can't break out regardless of its contents.
      try {
        const out = execFileSync("docker", ["exec", "postgres", "psql", "-U", "matrx", "-d", db, "-c", query], { encoding: "utf-8", timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
        return textResult({ success: true, output: out.trim() });
      } catch (e) {
        return textResult({ success: false, output: e.stdout?.trim() || "", error: e.stderr?.trim() || e.message });
      }
    }
  );

  // ── APP DEPLOYMENT TOOLS ────────────────────────────────────────────────
  server.tool("app_create",
    "Create a fully isolated matrx-ship instance with its own PostgreSQL and Traefik subdomain.",
    { name: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/), display_name: z.string(), api_key: z.string().optional(), postgres_image: z.string().optional() },
    async ({ name, display_name, api_key, postgres_image }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      return textResult(createInstance(name, display_name, api_key, postgres_image));
    }
  );

  server.tool("app_list", "List all deployed instances.", {},
    async () => textResult(listInstances())
  );

  server.tool("app_remove", "Remove a matrx-ship instance.",
    { name: z.string(), delete_data: z.boolean().optional(), force: z.boolean().optional() },
    async ({ name, delete_data, force }) => {
      const g = gate("admin"); if (g) return g;
      if (!isValidInstanceName(name)) return textResult({ error: "Invalid instance name" });
      return textResult(removeInstance(name, delete_data, force));
    }
  );

  server.tool("app_backup", "Backup an instance's PostgreSQL database.",
    { name: z.string() },
    async ({ name }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      if (!isValidInstanceName(name)) return textResult({ error: "Invalid instance name" });
      const config = loadDeployments();
      if (!config.instances[name]) return textResult({ error: `Instance '${name}' not found` });
      mkdirSync(join(BACKUPS_DIR, name), { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const file = `${name}_${ts}.sql`;
      const path = join(BACKUPS_DIR, name, file);
      const result = exec(`docker exec db-${name} pg_dump -U ship ship > ${path}`, { timeout: 60000 });
      if (result.success) return textResult({ success: true, instance: name, backup_file: `/srv/apps/backups/${name}/${file}`, size: formatBytes(statSync(path).size) });
      return textResult({ success: false, error: result.error });
    }
  );

  server.tool("app_rebuild", "Rebuild the matrx-ship Docker image and restart instances. Omit name to restart all.",
    { name: z.string().optional(), skip_build: z.boolean().optional() },
    async ({ name, skip_build }) => {
      const g = gate("admin", "deployer"); if (g) return g;
      if (name != null && !isValidInstanceName(name)) return textResult({ error: "Invalid instance name" });
      return textResult(rebuildInstances({ name, skip_build, triggered_by: "manager-mcp" }));
    }
  );

  server.tool("self_rebuild", "Rebuild and restart the server manager itself. Warning: connection will drop briefly.",
    {},
    async () => { const g = gate("admin"); if (g) return g; return textResult(selfRebuild()); }
  );

  // ── BUILD INFO / HISTORY / ROLLBACK / CLEANUP ──────────────────────────

  server.tool("build_info", "Get pre-build preview: current image age, pending source changes, git diff stats, instances affected.",
    {},
    async () => textResult(getBuildInfo())
  );

  server.tool("build_history", "List past builds with tags, git commits, timestamps, and status.",
    { limit: z.number().optional(), include_failed: z.boolean().optional() },
    async ({ limit, include_failed }) => textResult(getBuildHistory({ limit, include_failed }))
  );

  server.tool("build_rollback", "Rollback to a previous image tag. Retags the specified image as :latest and restarts all instances.",
    { tag: z.string().describe("The image tag to rollback to, e.g. '20260211-204100'") },
    async ({ tag }) => { const g = gate("admin"); if (g) return g; return textResult(rollbackBuild(tag)); }
  );

  server.tool("build_cleanup", "Run retention cleanup on Docker image tags. Keeps last 3, 1/week for 4 weeks, 1/month for 3 months.",
    {},
    async () => { const g = gate("admin"); if (g) return g; return textResult(cleanupBuildImages()); }
  );

  // ── S3 BACKUP / ARCHIVE TOOLS ─────────────────────────────────────────

  server.tool("s3_status", "Check if AWS S3 is configured for backups/archival.",
    {},
    async () => textResult({ configured: isS3Configured(), bucket: process.env.S3_BACKUP_BUCKET || null, region: process.env.AWS_DEFAULT_REGION || null })
  );

  server.tool("s3_upload_image", "Upload a Docker image tag to S3 as a gzipped tarball.",
    { tag: z.string().describe("Image tag to upload, e.g. '20260211-204100'") },
    async ({ tag }) => { const g = gate("admin"); if (g) return g; return textResult(s3UploadImageTag(tag)); }
  );

  server.tool("s3_upload_backup", "Upload a database backup to S3.",
    { instance_name: z.string(), backup_file: z.string() },
    async ({ instance_name, backup_file }) => { const g = gate("admin"); if (g) return g; return textResult(s3UploadBackup(instance_name, backup_file)); }
  );

  server.tool("s3_list", "List all files in the S3 backup bucket.",
    {},
    async () => textResult(s3ListBackups())
  );

  server.tool("app_logs", "Get logs from a matrx-ship instance.",
    { name: z.string(), service: z.enum(["app", "db", "both"]).optional(), tail: z.number().optional() },
    async ({ name, service, tail }) => {
      if (!isValidInstanceName(name)) return textResult({ error: "Invalid instance name" });
      const n = Math.min(Math.max(parseInt(tail, 10) || 80, 1), 100000); const svc = service || "app"; const r = {};
      if (svc === "app" || svc === "both") r.app = exec(`docker logs ${name} --tail ${n} 2>&1`);
      if (svc === "db" || svc === "both") r.db = exec(`docker logs db-${name} --tail ${n} 2>&1`);
      return textResult(r);
    }
  );

  server.tool("app_env_update", "Update environment variables for an instance.",
    { name: z.string(), env_vars: z.record(z.string()), restart: z.boolean().optional() },
    async ({ name, env_vars, restart }) => {
      const g = gate("admin"); if (g) return g;
      if (!isValidInstanceName(name)) return textResult({ error: "Invalid instance name" });
      const config = loadDeployments();
      if (!config.instances[name]) return textResult({ error: `Instance '${name}' not found` });
      // Only accept well-formed env var names. Without this, a key like `FOO|BAR`
      // becomes the regex /^FOO|BAR=.*$/m and corrupts unrelated lines.
      const badKey = Object.keys(env_vars).find((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
      if (badKey) return textResult({ error: `Invalid env var name: ${badKey}` });
      const envPath = join(APPS_DIR, name, ".env");
      let content = readFileSync(envPath, "utf-8");
      for (const [k, v] of Object.entries(env_vars)) {
        const re = new RegExp(`^${escapeRegExp(k)}=.*$`, "m");
        // Function replacer so `$&`, `$1`, etc. in the value aren't interpreted.
        content = re.test(content) ? content.replace(re, () => `${k}=${v}`) : content + `\n${k}=${v}`;
      }
      writeFileAtomic(envPath, content);
      let rr = null;
      if (restart !== false) rr = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, name), timeout: 60000 });
      return textResult({ success: true, instance: name, updated_vars: Object.keys(env_vars), restarted: restart !== false, restart_output: rr?.output });
    }
  );

  // ── RESOURCES ───────────────────────────────────────────────────────────
  server.resource("server-info", "info://server", async () => ({
    contents: [{ uri: "info://server", text: JSON.stringify({ name: "matrx-server-manager", version: "2.0.0", hostname: "srv504398.hstgr.cloud", ip: "77.37.62.64", domain: "*.dev.codematrx.com" }, null, 2) }],
  }));

  server.resource("server-runbook", "docs://runbook", async () => {
    try { return { contents: [{ uri: "docs://runbook", text: readFileSync(join(HOST_SRV, "SERVER-RUNBOOK.md"), "utf-8") }] }; }
    catch { return { contents: [{ uri: "docs://runbook", text: "Runbook not found" }] }; }
  });

  server.resource("app-deployments", "info://app-deployments", async () => {
    try { return { contents: [{ uri: "info://app-deployments", text: JSON.stringify(loadDeployments(), null, 2) }] }; }
    catch { return { contents: [{ uri: "info://app-deployments", text: "No deployments" }] }; }
  });

  server.resource("directory-structure", "info://directory-structure", async () => {
    const r = exec(`find ${HOST_SRV} -maxdepth 3 -type f | sed 's|${HOST_SRV}|/srv|g' | sort`);
    return { contents: [{ uri: "info://directory-structure", text: r.output || "Could not list" }] };
  });

  return server;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  EXPRESS APP + REST API                                                   ║
// ╚════════════════════════════════════════════════════════════════════════════╝

const app = express();
app.use(express.json());

// Admin UI is now served by Next.js on port 3001 — Traefik routes /admin/* there.
// Keep favicon + root redirect for direct Express access.
app.get("/favicon.ico", (_req, res) => res.sendFile(join(__dirname, "..", "public", "matrx-icon-purple.svg")));
app.get("/icon.svg", (_req, res) => res.sendFile(join(__dirname, "..", "public", "matrx-icon-purple.svg")));

// Redirect bare / to /admin (handled by Next.js via Traefik)
app.get("/", (_req, res) => res.redirect("/admin"));

// Health (no auth)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "matrx-server-manager", timestamp: new Date().toISOString(), uptime: Math.floor(process.uptime()) });
});

// ── REST API (auth required) ──────────────────────────────────────────────

// Instances
app.get("/api/instances", authMiddleware, async (_req, res) => {
  res.json(listInstances());
});

// Reject malformed instance names before any handler interpolates them into a
// docker shell command. Scoped to /api/instances/:name* only — container and
// sandbox routes have their own (looser) name rules and are matched elsewhere.
app.use("/api/instances/:name", requireValidName);

app.get("/api/instances/:name", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const config = loadDeployments();
  const info = config.instances[name];
  if (!info) return res.status(404).json({ error: "Instance not found" });

  // Container details
  const appInspect = exec(`docker inspect ${name} 2>/dev/null`);
  const dbInspect = exec(`docker inspect db-${name} 2>/dev/null`);

  let appDetails = null, dbDetails = null;
  try {
    const raw = JSON.parse(appInspect.output);
    const c = raw[0];
    appDetails = {
      status: c.State?.Status,
      running: c.State?.Running,
      started_at: c.State?.StartedAt,
      created: c.Created,
      image: c.Config?.Image,
      restart_count: c.RestartCount,
      ports: c.NetworkSettings?.Ports,
      networks: Object.keys(c.NetworkSettings?.Networks || {}),
      health: c.State?.Health?.Status || null,
    };
  } catch { }
  try {
    const raw = JSON.parse(dbInspect.output);
    const c = raw[0];
    dbDetails = {
      status: c.State?.Status,
      running: c.State?.Running,
      started_at: c.State?.StartedAt,
      created: c.Created,
      image: c.Config?.Image,
      restart_count: c.RestartCount,
      health: c.State?.Health?.Status || null,
    };
  } catch { }

  // Container stats (CPU + memory) — one-shot, no stream
  const appStats = exec(`docker stats ${name} --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","mem_pct":"{{.MemPerc}}","net":"{{.NetIO}}","block":"{{.BlockIO}}","pids":"{{.PIDs}}"}' 2>/dev/null`);
  const dbStats = exec(`docker stats db-${name} --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","mem_pct":"{{.MemPerc}}","net":"{{.NetIO}}","block":"{{.BlockIO}}","pids":"{{.PIDs}}"}' 2>/dev/null`);

  let appStatsData = null, dbStatsData = null;
  try { appStatsData = JSON.parse(appStats.output); } catch { }
  try { dbStatsData = JSON.parse(dbStats.output); } catch { }

  // Environment variables (from .env file, mask sensitive values)
  let envVars = [];
  try {
    const envContent = readFileSync(join(APPS_DIR, name, ".env"), "utf-8");
    envVars = envContent.split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => {
        const eq = l.indexOf("=");
        if (eq === -1) return null;
        const key = l.substring(0, eq).trim();
        const value = l.substring(eq + 1).trim();
        return { key, value, sensitive: /PASSWORD|SECRET|TOKEN|KEY/.test(key) };
      })
      .filter(Boolean);
  } catch { }

  // Backups list
  let backups = [];
  try {
    const backupDir = join(BACKUPS_DIR, name);
    if (existsSync(backupDir)) {
      backups = readdirSync(backupDir)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => {
          const st = statSync(join(backupDir, f));
          return { file: f, size: formatBytes(st.size), created: st.mtime.toISOString() };
        })
        .sort((a, b) => b.created.localeCompare(a.created));
    }
  } catch { }

  // Docker compose file
  let composeFile = null;
  try { composeFile = readFileSync(join(APPS_DIR, name, "docker-compose.yml"), "utf-8"); } catch { }

  res.json({
    name,
    display_name: info.display_name,
    url: info.url,
    admin_url: `${info.url}/admin`,
    api_key: info.api_key,
    db_password: info.db_password,
    postgres_image: info.postgres_image,
    created_at: info.created_at,
    status: info.status,
    directory: `/srv/apps/${name}/`,
    containers: {
      app: { name: `${name}`, ...appDetails, stats: appStatsData },
      db: { name: `db-${name}`, ...dbDetails, stats: dbStatsData },
    },
    env_vars: envVars,
    backups,
    compose_file: composeFile,
  });
});

// Dedicated sub-resource endpoints for instance detail views
app.get("/api/instances/:name/env", authMiddleware, requireSuperadmin, async (req, res) => {
  const name = req.params.name;
  const config = loadDeployments();
  if (!config.instances[name]) return res.status(404).json({ error: "Instance not found" });
  const env = {};
  try {
    const content = readFileSync(join(APPS_DIR, name, ".env"), "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq > 0) env[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
    }
  } catch { }
  res.json({ env });
});

app.get("/api/instances/:name/compose", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const config = loadDeployments();
  if (!config.instances[name]) return res.status(404).json({ error: "Instance not found" });
  try {
    const content = readFileSync(join(APPS_DIR, name, "docker-compose.yml"), "utf-8");
    res.type("text/plain").send(content);
  } catch {
    res.status(404).json({ error: "Compose file not found" });
  }
});

app.get("/api/instances/:name/backups", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const config = loadDeployments();
  if (!config.instances[name]) return res.status(404).json({ error: "Instance not found" });
  const backups = [];
  try {
    const backupDir = join(BACKUPS_DIR, name);
    if (existsSync(backupDir)) {
      for (const f of readdirSync(backupDir).filter((x) => x.endsWith(".sql"))) {
        const st = statSync(join(backupDir, f));
        backups.push({ file: f, size: formatBytes(st.size), created: st.mtime.toISOString() });
      }
      backups.sort((a, b) => b.created.localeCompare(a.created));
    }
  } catch { }
  res.json({ backups });
});

app.post("/api/instances", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const { name, display_name, api_key, postgres_image } = req.body;
  if (!name || !display_name) return res.status(400).json({ error: "name and display_name required" });
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) return res.status(400).json({ error: "Invalid name format" });
  const result = createInstance(name, display_name, api_key, postgres_image);
  res.status(result.error ? 409 : 201).json(result);
});

app.delete("/api/instances/:name", authMiddleware, requireRole("admin"), async (req, res) => {
  const deleteData = req.query.delete_data === "true";
  const force = req.query.force === "true";
  const result = removeInstance(req.params.name, deleteData, force);
  res.status(result.success ? 200 : 500).json(result);
});

app.post("/api/instances/:name/restart", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.params.name;
  const instanceDir = join(APPS_DIR, name);
  if (!existsSync(join(instanceDir, "docker-compose.yml"))) return res.status(404).json({ error: "Instance not found" });
  res.json(exec("docker compose restart", { cwd: instanceDir, timeout: 60000 }));
});

app.post("/api/instances/:name/stop", authMiddleware, requireRole("admin"), async (req, res) => {
  const instanceDir = join(APPS_DIR, req.params.name);
  if (!existsSync(join(instanceDir, "docker-compose.yml"))) return res.status(404).json({ error: "Instance not found" });
  res.json(exec("docker compose stop", { cwd: instanceDir, timeout: 60000 }));
});

app.post("/api/instances/:name/start", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const instanceDir = join(APPS_DIR, req.params.name);
  if (!existsSync(join(instanceDir, "docker-compose.yml"))) return res.status(404).json({ error: "Instance not found" });
  res.json(exec("docker compose up -d", { cwd: instanceDir, timeout: 60000 }));
});

app.post("/api/instances/:name/backup", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.params.name;
  const config = loadDeployments();
  if (!config.instances[name]) return res.status(404).json({ error: "Instance not found" });
  mkdirSync(join(BACKUPS_DIR, name), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `${name}_${ts}.sql`;
  const path = join(BACKUPS_DIR, name, file);
  const result = exec(`docker exec db-${name} pg_dump -U ship ship > ${path}`, { timeout: 60000 });
  if (result.success) res.json({ success: true, backup_file: `/srv/apps/backups/${name}/${file}`, size: formatBytes(statSync(path).size) });
  else res.status(500).json({ success: false, error: result.error });
});

app.put("/api/instances/:name/env", authMiddleware, requireSuperadmin, async (req, res) => {
  const name = req.params.name;
  const config = loadDeployments();
  if (!config.instances[name]) return res.status(404).json({ error: "Instance not found" });
  const { env_vars, restart } = req.body;
  if (!env_vars || typeof env_vars !== "object") return res.status(400).json({ error: "env_vars object required" });
  const badKey = Object.keys(env_vars).find((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
  if (badKey) return res.status(400).json({ error: `Invalid env var name: ${badKey}` });
  const envPath = join(APPS_DIR, name, ".env");
  let content = readFileSync(envPath, "utf-8");
  for (const [k, v] of Object.entries(env_vars)) {
    const re = new RegExp(`^${escapeRegExp(k)}=.*$`, "m");
    content = re.test(content) ? content.replace(re, () => `${k}=${v}`) : content + `\n${k}=${v}`;
  }
  writeFileAtomic(envPath, content);
  let rr = null;
  if (restart !== false) rr = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, name), timeout: 60000 });
  res.json({ success: true, updated: Object.keys(env_vars), restarted: restart !== false, output: rr?.output });
});

// ── Rebuild / Deploy ────────────────────────────────────────────────────────

// Non-streaming rebuild (for tools and simple API calls)
app.post("/api/rebuild", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.query.name || req.body?.name || undefined;
  const skip_build = req.query.skip_build === "true" || req.body?.skip_build === true;
  const triggered_by = req.tokenEntry?.label || "api";
  const result = rebuildInstances({ name, skip_build, triggered_by });
  res.status(result.success ? 200 : 500).json(result);
});

// Redeploy ONLY app containers that aren't on matrx-ship:latest. No image
// rebuild — just recreate the lagging ones onto the current image. Backs the
// Versions "Redeploy N stale app(s)" button.
app.post("/api/rebuild/stale-only", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const latest = inspectImage("matrx-ship:latest");
  if (!latest.present) return res.status(409).json({ error: "matrx-ship:latest image is not present — rebuild the image first." });
  const cfg = loadDeployments();
  const stale = [];
  for (const [n] of Object.entries(cfg.instances || {})) {
    const img = exec(`docker inspect ${n} --format '{{.Image}}' 2>/dev/null`);
    const runId = (img.output || "").replace("sha256:", "").slice(0, 12);
    if (!runId || runId !== latest.id) stale.push(n);
  }
  if (stale.length === 0) return res.json({ success: true, message: "All apps already on the current image — nothing to do.", instances_recreated: [] });
  const results = {};
  for (const n of stale) {
    results[n] = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, n), timeout: 60000 });
  }
  const failed = Object.entries(results).filter(([, r]) => !r.success).map(([k]) => k);
  res.status(failed.length ? 500 : 200).json({
    success: failed.length === 0,
    instances_recreated: stale,
    failed,
    results,
  });
});

// Streaming rebuild — sends real-time build logs via Server-Sent Events
app.post("/api/rebuild/stream", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.query.name || req.body?.name || undefined;
  const skip_build = req.query.skip_build === "true" || req.body?.skip_build === true;
  const triggered_by = req.tokenEntry?.label || "deploy-ui";

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const config = loadDeployments();
  const src = resolveHostPath(config.defaults?.source || "/srv/projects/matrx-ship");
  const buildTag = generateBuildTag();
  const started_at = new Date().toISOString();

  const gitCommit = exec(`git -C ${src} rev-parse --short HEAD`);
  const gitLog = exec(`git -C ${src} log -1 --pretty=format:"%s"`);

  send("log", { message: `Build started at ${started_at}` });
  send("log", { message: `Source: ${src}` });
  send("log", { message: `Git: ${gitCommit.output || "?"} — ${gitLog.output || "?"}` });
  send("log", { message: `Build tag: ${buildTag}` });

  if (!skip_build) {
    // Tag current as rollback
    exec("docker tag matrx-ship:latest matrx-ship:rollback 2>/dev/null");
    send("log", { message: "Tagged current :latest as :rollback" });
    send("phase", { phase: "build", message: "Building Docker image..." });

    try {
      const buildResult = await new Promise((resolve, reject) => {
        const proc = spawn("docker", ["buildx", "build", "--load", "--progress=plain", "-t", `matrx-ship:latest`, "-t", `matrx-ship:${buildTag}`, src], {
          env: { ...process.env, PATH: process.env.PATH, DOCKER_BUILDKIT: "1" },
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk) => {
          const text = chunk.toString();
          stdout += text;
          for (const line of text.split("\n").filter(Boolean)) {
            send("log", { message: line });
          }
        });

        proc.stderr.on("data", (chunk) => {
          const text = chunk.toString();
          stderr += text;
          for (const line of text.split("\n").filter(Boolean)) {
            send("log", { message: line });
          }
        });

        proc.on("close", (code) => {
          if (code === 0) resolve({ success: true, output: stdout + stderr });
          else reject(new Error(stderr || `Build exited with code ${code}`));
        });

        proc.on("error", (err) => reject(err));
      });

      send("phase", { phase: "build-done", message: "Docker image built successfully" });

      // Get image ID
      const imgInspect = exec("docker inspect matrx-ship:latest --format '{{.Id}}'");
      const imageId = imgInspect.output?.replace("sha256:", "").substring(0, 12) || null;
      send("log", { message: `Image ID: ${imageId}` });

      // Restart instances
      const targets = name ? [name] : Object.keys(config.instances);
      send("phase", { phase: "restart", message: `Restarting ${targets.length} instance(s)...` });

      const restartResults = {};
      for (const t of targets) {
        if (!config.instances[t]) { restartResults[t] = { error: "not found" }; continue; }
        send("log", { message: `Restarting ${t}...` });
        restartResults[t] = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });
        send("log", { message: `${t}: ${restartResults[t].success ? "restarted" : restartResults[t].error}` });
      }

      const finished_at = new Date().toISOString();
      const duration_ms = Date.now() - new Date(started_at).getTime();

      // Record successful build
      recordBuild({
        id: `bld_${randomHex(6)}`,
        tag: buildTag,
        timestamp: started_at,
        git_commit: gitCommit.output || "unknown",
        git_message: gitLog.output || "unknown",
        image_id: imageId,
        success: true,
        error: null,
        duration_ms,
        triggered_by,
        instances_restarted: targets,
      });

      try { cleanupBuildImages(); } catch { /* non-fatal */ }

      send("done", { success: true, build_tag: buildTag, image_id: imageId, instances_restarted: targets, duration_ms, started_at, finished_at });
    } catch (err) {
      const duration_ms = Date.now() - new Date(started_at).getTime();

      recordBuild({
        id: `bld_${randomHex(6)}`,
        tag: buildTag,
        timestamp: started_at,
        git_commit: gitCommit.output || "unknown",
        git_message: gitLog.output || "unknown",
        image_id: null,
        success: false,
        error: err.message,
        duration_ms,
        triggered_by,
        instances_restarted: [],
      });

      send("error", { success: false, error: err.message, duration_ms });
    }
  } else {
    // Skip build, just restart
    const targets = name ? [name] : Object.keys(config.instances);
    send("phase", { phase: "restart", message: `Restarting ${targets.length} instance(s) (no rebuild)...` });

    for (const t of targets) {
      if (!config.instances[t]) continue;
      send("log", { message: `Restarting ${t}...` });
      const r = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });
      send("log", { message: `${t}: ${r.success ? "restarted" : r.error}` });
    }

    send("done", { success: true, instances_restarted: targets, image_rebuilt: false });
  }

  res.end();
});

// Streaming self-rebuild — sends real-time logs via Server-Sent Events
app.post("/api/self-rebuild/stream", authMiddleware, requireRole("admin"), async (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const smDir = join(HOST_SRV, "apps", "server-manager");
  if (!existsSync(join(smDir, "docker-compose.yml"))) {
    send("error", { success: false, error: "docker-compose.yml not found in /srv/apps/server-manager/" });
    res.end();
    return;
  }

  send("phase", { phase: "build", message: "Rebuilding server manager..." });
  send("log", { message: "Running: docker compose up -d --build server-manager" });
  send("log", { message: `Working directory: ${smDir}` });

  try {
    const proc = spawn("docker", ["compose", "up", "-d", "--build", "server-manager"], {
      cwd: smDir,
      env: { ...process.env, PATH: process.env.PATH },
    });

    proc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        send("log", { message: line });
      }
    });

    proc.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        send("log", { message: line });
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        send("done", { success: true, message: "Server manager rebuilt. This container will restart — connection will drop momentarily." });
      } else {
        send("error", { success: false, error: `docker compose exited with code ${code}` });
      }
      res.end();
    });

    proc.on("error", (err) => {
      send("error", { success: false, error: err.message });
      res.end();
    });
  } catch (err) {
    send("error", { success: false, error: err.message });
    res.end();
  }
});

// Non-streaming self-rebuild (for tools)
app.post("/api/self-rebuild", authMiddleware, requireRole("admin"), async (_req, res) => {
  const result = selfRebuild();
  res.status(result.success ? 200 : 500).json(result);
});

// ── Build Info / History / Rollback / Cleanup ─────────────────────────────

app.get("/api/build-info", authMiddleware, async (_req, res) => {
  res.json(getBuildInfo());
});

app.get("/api/build-history", authMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const include_failed = req.query.include_failed === "true";
  res.json(getBuildHistory({ limit, include_failed }));
});

app.post("/api/rollback", authMiddleware, requireRole("admin"), async (req, res) => {
  const tag = req.body?.tag || req.query.tag;
  if (!tag) return res.status(400).json({ error: "tag is required" });
  const result = rollbackBuild(tag);
  res.status(result.success ? 200 : 400).json(result);
});

app.post("/api/build-cleanup", authMiddleware, requireRole("admin"), async (_req, res) => {
  const result = cleanupBuildImages();
  res.json(result);
});

// ── S3 Backup / Archive ──────────────────────────────────────────────────

app.get("/api/s3/status", authMiddleware, async (_req, res) => {
  res.json({ configured: isS3Configured(), bucket: process.env.S3_BACKUP_BUCKET || null, region: process.env.AWS_DEFAULT_REGION || null });
});

app.post("/api/s3/upload-image", authMiddleware, requireRole("admin"), async (req, res) => {
  const tag = req.body?.tag;
  if (!tag) return res.status(400).json({ error: "tag is required" });
  const result = s3UploadImageTag(tag);
  res.status(result.success ? 200 : 400).json(result);
});

app.post("/api/s3/upload-backup", authMiddleware, requireRole("admin"), async (req, res) => {
  const { instance_name, backup_file } = req.body || {};
  if (!instance_name || !backup_file) return res.status(400).json({ error: "instance_name and backup_file are required" });
  const result = s3UploadBackup(instance_name, backup_file);
  res.status(result.success ? 200 : 400).json(result);
});

app.get("/api/s3/list", authMiddleware, async (_req, res) => {
  const result = s3ListBackups();
  res.status(result.success ? 200 : 400).json(result);
});

app.get("/api/instances/:name/logs", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const svc = req.query.service || "app";
  const n = parseInt(req.query.tail) || 80;
  const r = {};
  if (svc === "app" || svc === "both") r.app = exec(`docker logs ${name} --tail ${n} 2>&1`);
  if (svc === "db" || svc === "both") r.db = exec(`docker logs db-${name} --tail ${n} 2>&1`);
  res.json(r);
});

// ── Per-Instance Database Controls ──────────────────────────────────────────

app.get("/api/instances/:name/db/status", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const dbContainer = `db-${name}`;

  const inspect = exec(`docker inspect ${dbContainer} --format '{{json .State}}' 2>/dev/null`);
  if (!inspect.success) return res.status(404).json({ error: `Database container ${dbContainer} not found` });

  let state = null;
  try { state = JSON.parse(inspect.output); } catch { }

  const stats = exec(`docker stats ${dbContainer} --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","mem_pct":"{{.MemPerc}}"}' 2>/dev/null`);
  let statsData = null;
  try { if (stats.success) statsData = JSON.parse(stats.output); } catch { }

  const version = exec(`docker exec ${dbContainer} psql -U ship -d ship -tc "SELECT version()" 2>/dev/null`);
  const size = exec(`docker exec ${dbContainer} psql -U ship -d ship -tc "SELECT pg_size_pretty(pg_database_size('ship'))" 2>/dev/null`);
  const connections = exec(`docker exec ${dbContainer} psql -U ship -d ship -tc "SELECT count(*) FROM pg_stat_activity" 2>/dev/null`);

  res.json({
    container: dbContainer,
    status: state?.Status || "unknown",
    running: state?.Running || false,
    health: state?.Health?.Status || null,
    stats: statsData,
    version: version.output?.trim() || "unknown",
    size: size.output?.trim() || "unknown",
    connections: parseInt(connections.output?.trim() || "0") || 0,
  });
});

app.get("/api/instances/:name/db/tables", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const dbContainer = `db-${name}`;

  const result = exec(`docker exec ${dbContainer} psql -U ship -d ship -tc "SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size, n_live_tup as rows FROM pg_stat_user_tables JOIN pg_tables USING (tablename, schemaname) ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC" 2>/dev/null`);

  if (!result.success) return res.status(500).json({ error: result.error || "Failed to query tables" });

  const tables = result.output
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      return { name: parts[0], size: parts[1], rows: parseInt(parts[2]) || 0 };
    })
    .filter((t) => t.name);

  res.json({ tables, count: tables.length });
});

app.post("/api/instances/:name/db/query", authMiddleware, requireRole("admin"), async (req, res) => {
  const name = req.params.name;
  const dbContainer = `db-${name}`;
  const { query } = req.body;

  if (!query) return res.status(400).json({ error: "query is required" });

  // Only allow read-only queries
  const trimmed = query.trim().toUpperCase();
  if (!["SELECT", "SHOW", "EXPLAIN", "\\D"].some((p) => trimmed.startsWith(p))) {
    return res.status(400).json({ error: "Only read-only queries allowed (SELECT, SHOW, EXPLAIN)" });
  }

  const result = exec(`docker exec ${dbContainer} psql -U ship -d ship -c '${query.replace(/'/g, "'\\''")}'`, { timeout: 15000 });
  res.json({ success: result.success, output: result.output || result.error });
});

app.post("/api/instances/:name/db/restore", authMiddleware, requireRole("admin"), async (req, res) => {
  const name = req.params.name;
  const dbContainer = `db-${name}`;
  const { backup_file } = req.body;

  if (!backup_file) return res.status(400).json({ error: "backup_file is required" });

  const backupPath = join(BACKUPS_DIR, name, backup_file);
  if (!existsSync(backupPath)) return res.status(404).json({ error: `Backup file not found: ${backup_file}` });

  // Restore the backup
  const result = exec(`cat ${backupPath} | docker exec -i ${dbContainer} psql -U ship -d ship`, { timeout: 120000 });

  auditLog(req.tokenEntry?.label || "api", "db_restore", name, { backup_file, success: result.success });

  res.json({ success: result.success, output: result.output || result.error });
});

// ── Streaming Logs (SSE) ────────────────────────────────────────────────────

app.get("/api/instances/:name/logs/stream", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const service = req.query.service || "app";
  const container = service === "db" ? `db-${name}` : name;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const proc = spawn("docker", ["logs", container, "--follow", "--tail", "50", "--timestamps"], {
    env: { ...process.env, PATH: process.env.PATH },
  });

  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      res.write(`data: ${JSON.stringify({ message: line })}\n\n`);
    }
  });

  proc.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      res.write(`data: ${JSON.stringify({ message: line })}\n\n`);
    }
  });

  proc.on("close", () => {
    res.write(`event: close\ndata: {}\n\n`);
    res.end();
  });

  req.on("close", () => {
    proc.kill("SIGTERM");
  });
});

// ── Instance Exec (for terminal) ────────────────────────────────────────────

app.post("/api/instances/:name/exec", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.params.name;
  const { command, service } = req.body;

  if (!command) return res.status(400).json({ error: "command is required" });

  const container = service === "db" ? `db-${name}` : name;
  const result = exec(`docker exec ${container} sh -c '${command.replace(/'/g, "'\\''")}'`, { timeout: 30000 });

  res.json({ success: result.success, output: result.output || result.error });
});

// ── Database Health Audit ────────────────────────────────────────────────────

app.get("/api/db-health", authMiddleware, async (_req, res) => {
  const config = loadDeployments();
  const results = [];

  for (const [name, info] of Object.entries(config.instances)) {
    const appStatus = exec(`docker inspect ${name} --format '{{.State.Status}}' 2>/dev/null`);
    const dbStatus = exec(`docker inspect db-${name} --format '{{.State.Status}}' 2>/dev/null`);
    const dbHealth = exec(`docker inspect db-${name} --format '{{.State.Health.Status}}' 2>/dev/null`);

    let connected = false;
    if (dbStatus.success && dbStatus.output === "running") {
      const ping = exec(`docker exec db-${name} pg_isready -U ship 2>/dev/null`);
      connected = ping.success;
    }

    results.push({
      instance: name,
      display_name: info.display_name,
      app_status: appStatus.output || "not found",
      db_container: `db-${name}`,
      db_status: dbStatus.output || "not found",
      db_health: dbHealth.output || "none",
      db_connected: connected,
      postgres_image: info.postgres_image || "unknown",
    });
  }

  const healthy = results.filter((r) => r.db_connected).length;
  const unhealthy = results.filter((r) => !r.db_connected).length;

  res.json({ instances: results, healthy, unhealthy, total: results.length });
});

// ── Outdated Image Detection ────────────────────────────────────────────────

app.get("/api/instances/outdated", authMiddleware, async (_req, res) => {
  const config = loadDeployments();
  const latestImageId = exec("docker inspect matrx-ship:latest --format '{{.Id}}' 2>/dev/null");

  if (!latestImageId.success) {
    return res.json({ error: "Could not inspect matrx-ship:latest", instances: [] });
  }

  const results = [];
  for (const [name] of Object.entries(config.instances)) {
    const instanceImageId = exec(`docker inspect ${name} --format '{{.Image}}' 2>/dev/null`);
    const isOutdated = instanceImageId.success && instanceImageId.output !== latestImageId.output;
    results.push({
      instance: name,
      current_image: instanceImageId.output?.substring(0, 19) || "unknown",
      latest_image: latestImageId.output?.substring(0, 19) || "unknown",
      outdated: isOutdated,
    });
  }

  const outdatedCount = results.filter((r) => r.outdated).length;
  res.json({ instances: results, outdated_count: outdatedCount, total: results.length });
});

// ── Documentation ───────────────────────────────────────────────────────────

app.get("/api/docs", authMiddleware, async (req, res) => {
  const docsDir = join(HOST_SRV, "projects/matrx-ship/docs/ops");
  const slug = req.query.slug;

  if (slug) {
    const docPath = join(docsDir, `${slug}.md`);
    if (!existsSync(docPath)) return res.status(404).json({ error: "Document not found" });
    try {
      const content = readFileSync(docPath, "utf-8");
      return res.json({ slug, content });
    } catch {
      return res.status(500).json({ error: "Failed to read document" });
    }
  }

  // List all docs
  function getDocsTree(dir, prefix = "") {
    if (!existsSync(dir)) return [];
    const entries = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        entries.push(...getDocsTree(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name));
      } else if (entry.name.endsWith(".md")) {
        const base = entry.name.replace(".md", "");
        const slug = prefix ? `${prefix}/${base}` : base;
        const title = base.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        entries.push({ slug, title });
      }
    }
    return entries;
  }

  const docs = getDocsTree(docsDir);
  res.json({ docs });
});

// ── Sandboxes ──────────────────────────────────────────────────────────────
function listSandboxes() {
  try {
    const raw = execSync(
      `docker ps -a --filter "name=sandbox-" --format '{{json .}}'`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
    if (!raw) return [];
    return raw.split("\n").filter(Boolean).map((line) => {
      const c = JSON.parse(line);
      // Only include actual sandbox instances (sandbox-1, sandbox-2, etc.)
      if (!/^sandbox-\d+$/.test(c.Names)) return null;
      const name = c.Names;
      const num = name.replace("sandbox-", "");
      return {
        name,
        id: c.ID,
        status: c.Status,
        state: c.State,  // running, exited, etc
        image: c.Image,
        created: c.CreatedAt,
        url: `https://${name}.${DOMAIN_SUFFIX}`,
        ports: c.Ports,
      };
    }).filter(Boolean);
  } catch { return []; }
}

function getSandboxDetail(name) {
  try {
    const raw = execSync(
      `docker inspect ${name} --format '{{json .}}'`,
      { encoding: "utf-8", timeout: 10000 }
    );
    const c = JSON.parse(raw);
    const env = {};
    (c.Config?.Env || []).forEach((e) => {
      const [k, ...v] = e.split("=");
      env[k] = v.join("=");
    });
    // Get stats
    let stats = null;
    try {
      const s = execSync(
        `docker stats ${name} --no-stream --format '{{json .}}'`,
        { encoding: "utf-8", timeout: 5000 }
      );
      stats = JSON.parse(s);
    } catch { }

    // Get logs
    let logs = "";
    try {
      logs = execSync(`docker logs ${name} --tail 100 2>&1`, { encoding: "utf-8", timeout: 5000 });
    } catch { }

    return {
      name,
      url: `https://${name}.${DOMAIN_SUFFIX}`,
      state: c.State?.Status || "unknown",
      started_at: c.State?.StartedAt,
      created: c.Created,
      image: c.Config?.Image,
      sandbox_id: env.SANDBOX_ID || "",
      sandbox_mode: env.SANDBOX_MODE || "",
      env,
      stats: stats ? {
        cpu: stats.CPUPerc,
        mem: stats.MemUsage,
        mem_pct: stats.MemPerc,
        net: stats.NetIO,
        block: stats.BlockIO,
        pids: stats.PIDs,
      } : null,
      health: c.State?.Health?.Status || null,
      restart_count: c.RestartCount,
      logs,
    };
  } catch (e) {
    return { error: e.message };
  }
}

app.get("/api/sandboxes", authMiddleware, async (_req, res) => {
  const sandboxes = listSandboxes();
  res.json({ sandboxes, count: sandboxes.length });
});

app.get("/api/sandboxes/:name", authMiddleware, async (req, res) => {
  const name = req.params.name;
  if (!/^sandbox-\d+$/.test(name)) return res.status(400).json({ error: "Invalid sandbox name" });
  const detail = getSandboxDetail(name);
  if (detail.error) return res.status(404).json(detail);
  res.json(detail);
});

app.get("/api/sandboxes/:name/logs", authMiddleware, async (req, res) => {
  const name = req.params.name;
  if (!/^sandbox-\d+$/.test(name)) return res.status(400).json({ error: "Invalid sandbox name" });
  // Coerce tail to a bounded integer — it was interpolated unquoted, so a value
  // like `200 && docker rmi …` would have run as a second command.
  const tail = Math.min(Math.max(parseInt(req.query.tail, 10) || 200, 1), 10000);
  try {
    const output = execSync(`docker logs ${name} --tail ${tail} 2>&1`, { encoding: "utf-8", timeout: 10000 });
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sandboxes/:name/restart", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.params.name;
  if (!/^sandbox-\d+$/.test(name)) return res.status(400).json({ error: "Invalid sandbox name" });
  try {
    execSync(`docker restart ${name}`, { timeout: 30000 });
    res.json({ success: true, message: `Restarted ${name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sandboxes/:name/stop", authMiddleware, requireRole("admin"), async (req, res) => {
  const name = req.params.name;
  if (!/^sandbox-\d+$/.test(name)) return res.status(400).json({ error: "Invalid sandbox name" });
  try {
    execSync(`docker stop ${name}`, { timeout: 30000 });
    res.json({ success: true, message: `Stopped ${name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sandboxes/:name/start", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.params.name;
  if (!/^sandbox-\d+$/.test(name)) return res.status(400).json({ error: "Invalid sandbox name" });
  try {
    execSync(`docker start ${name}`, { timeout: 30000 });
    res.json({ success: true, message: `Started ${name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sandboxes/:name/exec", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const name = req.params.name;
  const { command } = req.body;
  if (!/^sandbox-\d+$/.test(name)) return res.status(400).json({ error: "Invalid sandbox name" });
  if (!command) return res.status(400).json({ error: "command required" });
  // argv-style spawn — no shell-string concatenation. The previous form
  // built `bash -c "${command.replace(/"/g, '\\"')}"`, which only escaped
  // double-quotes — backticks, $(...), backslashes still let an admin
  // (or anything that gets the admin token) break out. With execFileSync
  // every element of argv is passed as a separate process argument and
  // the shell only interprets `command` itself, not the surrounding wrap.
  try {
    const output = execFileSync(
      "docker",
      ["exec", "-u", "agent", name, "bash", "-c", command],
      { encoding: "utf-8", timeout: 30000 },
    );
    res.json({ output });
  } catch (e) { res.status(500).json({ output: e.stdout || "", error: e.stderr || e.message }); }
});

// ─── Orchestrator-spawned sandboxes (sbx-XXX) ──────────────────────────────
// The static sandbox-N pool above pre-dates the orchestrator and is being
// retired. The /api/orchestrator-sandboxes/* surface below talks to the
// hosted matrx-orchestrator (`https://orchestrator.dev.codematrx.com` or
// the URL in MATRX_HOSTED_ORCHESTRATOR_URL) so the Server Manager admin UI
// can show every dynamically-spawned aidream sandbox + its diagnostics +
// live logs without touching the host's docker daemon directly.
//
// The orchestrator's own auth (master X-API-Key) gates these — we read
// the key from MATRX_HOSTED_ORCHESTRATOR_API_KEY here, which is set in
// the manager's docker-compose env_file. NEVER expose this key to the
// browser; the manager admin UI calls these endpoints as itself.

const ORCH_URL = (process.env.MATRX_HOSTED_ORCHESTRATOR_URL || "https://orchestrator.dev.codematrx.com").replace(/\/$/, "");
const ORCH_KEY = process.env.MATRX_HOSTED_ORCHESTRATOR_API_KEY || process.env.SANDBOX_ORCHESTRATOR_HOSTED_API_KEY || "";
// EC2-tier orchestrator (matrx-sandbox-host-dev). Only its public root (`/`) is
// read for drift detection — no API key needed. Override via env if the IP moves.
const EC2_ORCH_URL = (process.env.MATRX_EC2_ORCHESTRATOR_URL || "http://54.144.86.132:8000").replace(/\/$/, "");

async function orchFetch(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (ORCH_KEY) headers["X-API-Key"] = ORCH_KEY;
  return fetch(`${ORCH_URL}${path}`, { ...init, headers });
}

// ── Tier-aware routing ──────────────────────────────────────────────────────
// A box's per-box actions (logs/diagnostics/fs/lifecycle/migrate) must hit the
// orchestrator that actually HOSTS it — the hosted one can't reach ec2
// containers and vice-versa. The list + detail come from the hosted orchestrator
// (its store is the shared sandbox_instances DB, so it returns rows for BOTH
// tiers, each carrying its `tier`). We cache sandbox_id -> tier from those and
// fall back to a one-shot detail lookup on a miss.
const EC2_ORCH_KEY = process.env.MATRX_EC2_ORCHESTRATOR_API_KEY || "";

function orchForTier(tier) {
  if (tier === "ec2") return { url: EC2_ORCH_URL, key: EC2_ORCH_KEY, tier: "ec2" };
  return { url: ORCH_URL, key: ORCH_KEY, tier: "hosted" };
}

const _tierCache = new Map(); // sandbox_id -> { tier, ts }
const TIER_TTL_MS = 5 * 60 * 1000;
function rememberTier(sandboxId, tier) {
  if (sandboxId && tier) _tierCache.set(sandboxId, { tier, ts: Date.now() });
}
async function resolveTier(sandboxId) {
  const c = _tierCache.get(sandboxId);
  if (c && Date.now() - c.ts < TIER_TTL_MS) return c.tier;
  try {
    const r = await orchFetch(`/sandboxes/${encodeURIComponent(sandboxId)}`);
    if (r.ok) {
      const row = await r.json();
      const tier = row?.tier || "hosted";
      rememberTier(sandboxId, tier);
      return tier;
    }
  } catch { /* fall through to default */ }
  return "hosted";
}

// Fetch a per-sandbox path against the orchestrator that hosts that box. When
// that tier's orchestrator isn't wired up (e.g. ec2 key unset), returns a clear
// 503 instead of a misleading "not running" from the wrong orchestrator.
async function orchFetchForSandbox(sandboxId, path, init = {}) {
  const tier = await resolveTier(sandboxId);
  const { url, key, tier: t } = orchForTier(tier);
  if (!key) {
    return new Response(
      JSON.stringify({
        error: `This box runs on the '${t}' tier, but the Manager isn't connected to that orchestrator yet `
          + `(set MATRX_${t.toUpperCase()}_ORCHESTRATOR_API_KEY).`,
        tier: t, not_connected: true,
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
  const headers = { ...(init.headers || {}) };
  headers["X-API-Key"] = key;
  return fetch(`${url}${path}`, { ...init, headers });
}

// ── Sandbox image + orchestrator build surface ──────────────────────────────
// Closes the 2026-04-30 incident gap: there was NO UI to see whether the
// matrx-sandbox:* image tags exist or to rebuild them / the orchestrator —
// a pruned tag silently bricked sandbox spawning until someone SSH'd in.
// Paths are the manager-container view of the host (/host-srv == host /srv);
// `docker build` reads the context from inside this container and ships it to
// the host daemon over the mounted socket, so these /host-srv paths are correct.
const SANDBOX_PROJECT = join(HOST_SRV, "projects", "matrx-sandbox");
const ORCH_COMPOSE_DIR = join(HOST_SRV, "apps", "sandbox-orchestrator");
// Build recipes per variant. core/slim/local are plain `docker build`; aidream
// runs the repo's build-aidream.sh (it stages an aidream checkout into context
// and requires :core first).
// `required: true` = the orchestrator actually spawns from this tag at runtime,
// so its absence breaks spawning (incident condition → banner). core is only a
// BUILD dependency of aidream; local is the deprecated static pool — both are
// surfaced but their absence is not an alarm.
const SANDBOX_IMAGE_VARIANTS = {
  core: { tag: "matrx-sandbox:core", context: join(SANDBOX_PROJECT, "sandbox-image"), required: false },
  slim: { tag: "matrx-sandbox:slim", context: join(SANDBOX_PROJECT, "sandbox-image"), dockerfile: "Dockerfile.slim", required: true },
  local: { tag: "matrx-sandbox:local", context: join(SANDBOX_PROJECT, "sandbox-local"), required: false },
  aidream: { tag: "matrx-sandbox:aidream", script: join(SANDBOX_PROJECT, "sandbox-image", "build-aidream.sh"), required: true },
};
const ORCH_IMAGE_TAG = "matrx-orchestrator:latest";

// Inspect one image tag; returns presence + size + age (read-only).
function inspectImage(tag) {
  const r = exec(`docker image inspect ${tag} --format '{{.Id}}|{{.Size}}|{{.Created}}'`);
  if (!r.success || !r.output) return { tag, present: false };
  const [id, size, created] = r.output.split("|");
  return {
    tag,
    present: true,
    id: (id || "").replace("sha256:", "").slice(0, 12),
    size_bytes: Number(size) || null,
    created: created || null,
  };
}

// ── Sandbox-image build markers ─────────────────────────────────────────────
// Both deploy-hosted.sh (host-side, on every deploy) and the Manager's own UI
// rebuild endpoints drop a marker file here WHILE an image variant builds, and
// remove it when done. Fleet Health + the image-health banner read it so a
// "missing required image" reads as "rebuilding…" (not a false critical) during
// the multi-minute aidream build. Path matches deploy-hosted.sh's
// IMAGE_BUILD_STATUS_DIR (=/srv/apps/image-build-status). A marker older than
// the TTL is treated as stale (the build process died) and ignored.
const IMAGE_BUILD_STATUS_DIR = join(APPS_DIR, "image-build-status");
const IMAGE_BUILD_MARKER_TTL_MS = 30 * 60 * 1000;

function imageBuildInProgress(variant) {
  try {
    const f = join(IMAGE_BUILD_STATUS_DIR, `${variant}.json`);
    if (!existsSync(f)) return null;
    const ageMs = Date.now() - statSync(f).mtimeMs;
    if (ageMs > IMAGE_BUILD_MARKER_TTL_MS) return null; // stale → build died
    let info = {};
    try { info = JSON.parse(readFileSync(f, "utf-8")); } catch { /* tolerate partial write */ }
    return { variant, started_at: info.started_at || null, source: info.source || "unknown", age_seconds: Math.round(ageMs / 1000) };
  } catch { return null; }
}

function markImageBuild(variant, source) {
  try {
    mkdirSync(IMAGE_BUILD_STATUS_DIR, { recursive: true });
    writeFileSync(join(IMAGE_BUILD_STATUS_DIR, `${variant}.json`), JSON.stringify({ variant, started_at: new Date().toISOString(), source }));
  } catch { /* non-fatal — marker is advisory */ }
}
function clearImageBuild(variant) {
  try { unlinkSync(join(IMAGE_BUILD_STATUS_DIR, `${variant}.json`)); } catch { /* already gone */ }
}

app.get("/api/orchestrator-sandboxes", authMiddleware, async (_req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured (set MATRX_HOSTED_ORCHESTRATOR_API_KEY)" });
  try {
    const r = await orchFetch("/sandboxes");
    if (!r.ok) return res.status(r.status).json({ error: `Orchestrator ${r.status}`, body: await r.text() });
    const data = await r.json();
    // Cache each box's tier so per-box actions route to the right orchestrator
    // without an extra lookup. The hosted /sandboxes returns BOTH tiers.
    try { for (const b of (data.sandboxes || [])) rememberTier(b.sandbox_id, b.tier); } catch { /* */ }
    res.json(data);
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

app.get("/api/orchestrator-sandboxes/:id", authMiddleware, async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  try {
    const r = await orchFetch(`/sandboxes/${encodeURIComponent(req.params.id)}`);
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

app.get("/api/orchestrator-sandboxes/:id/diagnostics", authMiddleware, async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/diagnostics`);
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

app.get("/api/orchestrator-sandboxes/:id/logs", authMiddleware, async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const source = req.query.source || "all";
  const tail = req.query.tail || 200;
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/logs?source=${encodeURIComponent(source)}&tail=${tail}`);
    res.status(r.status).type(r.headers.get("content-type") || "text/plain").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Reset (destroy + recreate) — proxies to POST /sandboxes/{id}/reset
app.post("/api/orchestrator-sandboxes/:id/reset", authMiddleware, async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const wipe = req.query.wipe_volume === "true" ? "true" : "false";
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/reset?wipe_volume=${wipe}`, { method: "POST" });
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Create a sandbox — proxies to POST /sandboxes on the (hosted) orchestrator.
// Body: { user_id (required UUID), template?, ttl_seconds?, tier?, config?,
// resources?, labels? }. Returns the new SandboxResponse.
app.post("/api/orchestrator-sandboxes", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const body = req.body || {};
  if (!body.user_id || !/^[0-9a-f-]{36}$/i.test(String(body.user_id))) {
    return res.status(400).json({ error: "user_id (a valid UUID) is required" });
  }
  try {
    const r = await orchFetch("/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Destroy (graceful stop + remove container, preserve per-user volume) —
// proxies to DELETE /sandboxes/{id}. This is the "force stop a stuck/unwanted
// sandbox" control: the volume survives, so a destroyed sandbox is resumable.
app.delete("/api/orchestrator-sandboxes/:id", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const graceful = req.query.graceful === "false" ? "false" : "true";
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}?graceful=${graceful}`, { method: "DELETE" });
    // 204 has no body; pass status through and surface any error text.
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Bulk destroy: pass {sandbox_ids: [...]} and we proxy a DELETE per id to the
// tier-correct orchestrator. Optional `graceful` (default true). Returns a
// per-id result map plus a summary count. Doesn't short-circuit on errors —
// each id is attempted independently so one failure doesn't block the rest.
//
// Use for cleaning up many stopped/failed/old sandboxes at once. Volumes
// follow whatever the orchestrator's DELETE policy is (currently: volume
// preserved on destroy unless the orchestrator was given wipe semantics).
app.post("/api/orchestrator-sandboxes/bulk-destroy", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const ids = Array.isArray(req.body?.sandbox_ids) ? req.body.sandbox_ids.filter((x) => typeof x === "string" && x) : [];
  if (ids.length === 0) return res.status(400).json({ error: "Provide a non-empty sandbox_ids array" });
  if (ids.length > 200) return res.status(400).json({ error: "Refuse to destroy >200 in one call — split the request" });
  const graceful = req.body?.graceful === false ? "false" : "true";
  // Run up to 4 in parallel so 50 ids don't take 50 sequential round-trips,
  // but don't fully fan out — the orchestrator + docker daemon are shared.
  const concurrency = 4;
  const results = {};
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const i = cursor++;
      const id = ids[i];
      try {
        const r = await orchFetchForSandbox(id, `/sandboxes/${encodeURIComponent(id)}?graceful=${graceful}`, { method: "DELETE" });
        const ok = r.status >= 200 && r.status < 300;
        results[id] = { status: r.status, ok, body: ok ? null : (await r.text()).slice(0, 400) };
      } catch (e) { results[id] = { status: 0, ok: false, body: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  const okCount = Object.values(results).filter((r) => r.ok).length;
  try { auditLog(req.tokenEntry?.label || "manager", "bulk_destroy_sandboxes", "orchestrator", { requested: ids.length, ok: okCount, failed: ids.length - okCount }); } catch { /* */ }
  res.json({ requested: ids.length, ok: okCount, failed: ids.length - okCount, results });
});

// Extend TTL — proxies to POST /sandboxes/{id}/extend with {ttl_seconds}.
app.post("/api/orchestrator-sandboxes/:id/extend", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const ttl = Number(req.body?.ttl_seconds);
  if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86400) {
    return res.status(400).json({ error: "ttl_seconds must be a number between 60 and 86400" });
  }
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: ttl }),
    });
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Resume — proxies to POST /sandboxes/{id}/resume (spawn a fresh container on
// the preserved volume for a stopped/expired sandbox). Returns the NEW row.
app.post("/api/orchestrator-sandboxes/:id/resume", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/resume`, { method: "POST" });
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// ── Zero-drift migration (see matrx-sandbox/docs/ZERO_DRIFT.md) ─────────────
// Drift report for the hosted tier. Hyphenated path (not /:id) so it doesn't
// collide with GET /api/orchestrator-sandboxes/:id.
app.get("/api/orchestrator-sandboxes-drift", authMiddleware, async (_req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  try {
    const r = await orchFetch("/drift");
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Roll every drifted box to the current image (busy boxes defer; S3-backed boxes
// are safely refused — see ZERO_DRIFT.md). Role-gated.
app.post("/api/orchestrator-sandboxes-migrate-all", authMiddleware, requireRole("admin", "deployer"), async (_req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  try {
    const r = await orchFetch("/migrate-all", { method: "POST" });
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Truthful freshness for the matrx-sandbox repo, by GIT COMMIT — NOT the version
// string (which has been reset across commits, e.g. 0.3.0 -> 0.1.2, so version
// numbers are NOT monotonic and must never be used to judge "newer"). Compares:
//   • origin/main HEAD sha (GitHub API)
//   • the EC2 deploy: the latest SUCCESSFUL "Deploy" run's commit (EC2 deploys
//     via GitHub Actions). EC2 is current when that == main HEAD.
//   • the hosted orchestrator: the /srv clone's HEAD (it's built from there).
// Cached 60s (this is hit by Versions + the 30s-refresh Fleet Health).
let _sbxRepoCache = { ts: 0, data: null };
async function getSandboxRepoState() {
  if (_sbxRepoCache.data && Date.now() - _sbxRepoCache.ts < 60000) return _sbxRepoCache.data;
  const repo = "armanisadeghi/matrx-sandbox";
  const pat = process.env.GITHUB_PAT || "";
  const s = {
    mainSha: null, mainShort: null, hostedHead: null, hostedShort: null, hostedBehind: null,
    deploySha: null, deployShort: null, deployWhen: null, deployUrl: null, deployFailures: 0,
    ec2Behind: null, ghError: null,
  };
  const h = exec(`git -C ${SANDBOX_PROJECT} rev-parse HEAD 2>/dev/null`);
  s.hostedHead = (h.output || "").trim() || null;
  s.hostedShort = s.hostedHead ? s.hostedHead.slice(0, 7) : null;
  if (pat) {
    try {
      const gh = async (p) => {
        const r = await fetch(`https://api.github.com/repos/${repo}${p}`, { headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(9000) });
        if (!r.ok) throw new Error(`GitHub API ${r.status}`);
        return r.json();
      };
      const main = await gh("/commits/main");
      s.mainSha = main.sha; s.mainShort = (main.sha || "").slice(0, 7);
      const runs = await gh("/actions/runs?per_page=20");
      const deploys = (runs.workflow_runs || []).filter((r) => r.name === "Deploy");
      const lastOk = deploys.find((r) => r.conclusion === "success");
      if (lastOk) { s.deploySha = lastOk.head_sha; s.deployShort = (lastOk.head_sha || "").slice(0, 7); s.deployWhen = lastOk.created_at; s.deployUrl = lastOk.html_url; }
      s.deployFailures = deploys.slice(0, 5).filter((r) => r.conclusion === "failure").length;
      s.ec2Behind = s.mainSha && s.deploySha ? s.deploySha !== s.mainSha : null;
    } catch (e) { s.ghError = e.message; }
  }
  s.hostedBehind = s.mainSha && s.hostedHead ? s.hostedHead !== s.mainSha : null;
  _sbxRepoCache = { ts: Date.now(), data: s };
  return s;
}

// ── Versions / Updates: is each system on the latest, or behind? ────────────
async function buildVersionsReport() {
  const systems = [];

  // 0) The Server Manager itself (THIS admin UI). It's a separate image
  //    (matrx-ship-manager) that's rebuilt + redeployed on every change, so it's
  //    current by construction. Shown first so it's clear the tool you're using
  //    is NOT the same thing as the app-portal image below.
  try {
    const mgr = inspectImage("matrx-ship-manager:latest");
    const ageH = mgr.created ? Math.floor((Date.now() - new Date(mgr.created).getTime()) / 3600000) : null;
    const age = ageH == null ? "" : ageH < 24 ? `${ageH}h old` : `${Math.floor(ageH / 24)}d old`;
    systems.push({
      id: "manager", name: "Server Manager (this admin UI)", kind: "manager",
      current: `image ${mgr.id || "?"}${age ? ` · ${age}` : ""}`,
      latest: "rebuilt on every deploy",
      status: "ok",
      detail: "This very app. It's its own image and is rebuilt + redeployed whenever a change ships, so it's always current — it is NOT the 'app portals' image below.",
      update: null,
    });
  } catch { /* */ }

  // 1) Ship platform + every app deployment.
  //
  //    Two distinct drift signals here — each gets its OWN row so the button
  //    matches the actual problem (the old single-row presentation was
  //    self-contradicting: "behind" header + "Rebuild all" while all sub-apps
  //    showed green, because the *source* was ahead but the apps were correctly
  //    on the built image):
  //      (a) "matrx-ship image" — source git HEAD vs the built image (`bi.has_changes`).
  //          Fix = rebuild the image (then apps + recreate).
  //      (b) "App portals" — does each app container actually run the current
  //          image id? Fix = recreate the lagging apps onto the current image.
  try {
    const bi = getBuildInfo();
    const latest = inspectImage("matrx-ship:latest");
    const cfg = loadDeployments();
    const apps = [];
    let behind = 0;
    for (const [name, info] of Object.entries(cfg.instances || {})) {
      const img = exec(`docker inspect ${name} --format '{{.Image}}' 2>/dev/null`);
      const runId = (img.output || "").replace("sha256:", "").slice(0, 12);
      const onLatest = !!(latest.present && runId && runId === latest.id);
      if (!onLatest) behind++;
      apps.push({ name, display_name: info.display_name || name, on_latest: onLatest });
    }
    const sourceAhead = !!bi.has_changes;
    const pendingCount = bi.pending_commits?.length || 0;

    // 1a) The image itself — is it built from current source?
    systems.push({
      id: "ship-image", name: "matrx-ship image (shared)", kind: "ship-image",
      current: `image ${bi.current_image?.id || "?"}${bi.current_image?.age ? ` · ${bi.current_image.age} old` : ""}`,
      latest: `source @ ${bi.source?.head_commit || "?"}`,
      status: sourceAhead ? "behind" : "ok",
      detail: sourceAhead
        ? `The matrx-ship image is ${pendingCount || "some"} commit(s) behind source. Rebuild it, then recreate the apps onto the new image. (Per-app DBs are separate volumes — untouched.)`
        : "Image is built from the current source commit.",
      update: sourceAhead
        ? {
          action: "ship-rebuild", label: "Rebuild image + redeploy all apps", data_safe: true,
          note: "docker build matrx-ship:latest from current source, then recreate every app container onto it. App DB volumes are untouched."
        }
        : null,
    });

    // 1b) Per-app rollout — are apps actually running the image we just built?
    systems.push({
      id: "ship-apps", name: "App portals — running image", kind: "ship-apps",
      current: behind === 0 ? `${apps.length}/${apps.length} on current image` : `${apps.length - behind}/${apps.length} on current image`,
      latest: `matrx-ship:latest (${latest.id || "?"})`,
      status: behind > 0 ? "behind" : "ok",
      detail: behind > 0
        ? `${behind} of ${apps.length} app(s) are running an older image and need to be recreated onto matrx-ship:latest. Each app's DB volume is untouched.`
        : `All ${apps.length} app(s) are running matrx-ship:latest.`,
      apps, behind_count: behind,
      update: behind > 0
        ? {
          action: "ship-redeploy-stale", label: `Redeploy ${behind} stale app(s)`, data_safe: true,
          note: "Recreates only the app containers that aren't on matrx-ship:latest. Each app's DB volume is untouched. (Per-app Redeploy buttons below also work.)"
        }
        : null,
    });
  } catch (e) { systems.push({ id: "ship-apps", name: "App portals — running image", kind: "ship-apps", status: "error", detail: String(e.message), update: null }); }

  const repo = await getSandboxRepoState();

  // 2) Hosted orchestrator — is the /srv clone it's built from at origin/main?
  //    (By git commit, NOT version string — see getSandboxRepoState.)
  try {
    let reachable = false;
    try { await fetchOrchestratorRoot(ORCH_URL); reachable = true; } catch { /* */ }
    const behind = repo.hostedBehind === true;
    const status = !reachable ? "error" : repo.hostedBehind == null ? "unknown" : behind ? "behind" : "ok";
    systems.push({
      id: "orch-hosted", name: "Sandbox orchestrator — hosted", kind: "orchestrator",
      current: `code @ ${repo.hostedShort || "?"}`,
      latest: `origin/main @ ${repo.mainShort || "?"}`,
      status,
      detail: !reachable ? "Orchestrator not responding."
        : repo.hostedBehind == null ? "Couldn't compare to origin (GitHub check unavailable)."
          : behind ? "The /srv source it's built from is behind origin/main — pull latest, rebuild, and restart."
            : "Built from origin/main — current.",
      update: behind
        ? {
          action: "orch-pull-redeploy", label: "Pull latest + rebuild + restart", data_safe: true,
          note: "git pull the /srv matrx-sandbox clone, rebuild the orchestrator image, recreate the container. No user data on the orchestrator."
        }
        : null,
    });
  } catch (e) { systems.push({ id: "orch-hosted", name: "Sandbox orchestrator — hosted", kind: "orchestrator", status: "error", detail: String(e.message), update: null }); }

  // 3) EC2 orchestrator — deploys via GitHub Actions. Current when the latest
  //    SUCCESSFUL Deploy run shipped origin/main HEAD (by commit, not version).
  try {
    let reachable = false; let runningVer = null;
    try { runningVer = (await fetchOrchestratorRoot(EC2_ORCH_URL)).version; reachable = true; } catch { /* */ }
    const behind = repo.ec2Behind === true;
    const status = !reachable ? "error" : repo.ec2Behind == null ? "unknown" : behind ? "behind" : "ok";
    const when = repo.deployWhen ? new Date(repo.deployWhen).toLocaleString() : "?";
    systems.push({
      id: "orch-ec2", name: "Sandbox orchestrator — EC2 tier", kind: "orchestrator-ec2",
      current: `deployed @ ${repo.deployShort || "?"}${runningVer ? ` (reports v${runningVer})` : ""}`,
      latest: `origin/main @ ${repo.mainShort || "?"}`,
      status,
      detail: (!reachable ? "EC2 orchestrator not responding. " : "")
        + (repo.ec2Behind == null ? "Couldn't compare to origin (GitHub check unavailable)."
          : behind ? `The latest deploy (${repo.deployShort}, ${when}) is behind origin/main (${repo.mainShort}) — trigger a deploy.`
            : `Up to date — latest GitHub Actions deploy shipped origin/main (${repo.deployShort}) on ${when}.`)
        + (repo.deployFailures ? ` ⚠ ${repo.deployFailures} of the last 5 deploys failed.` : "")
        + " (Note: the version NUMBER it reports is not a freshness signal — it's been reset across commits.)",
      update: behind
        ? {
          action: "ec2-trigger-deploy", label: "Trigger GitHub deploy", data_safe: true,
          note: "Dispatches the matrx-sandbox 'Deploy' workflow on main, which rebuilds + redeploys the EC2 orchestrator via SSM."
        }
        : null,
    });
  } catch (e) { systems.push({ id: "orch-ec2", name: "Sandbox orchestrator — EC2 tier", kind: "orchestrator-ec2", status: "error", detail: String(e.message), update: null }); }

  // 4) Sandboxes — zero-drift count.
  try {
    const r = await orchFetch("/drift");
    const d = await r.json();
    const drifted = d.drifted || 0, total = d.total || 0;
    systems.push({
      id: "sandboxes", name: "Sandboxes — running boxes", kind: "sandboxes",
      current: `${total} box(es) · ${drifted} on an old image`,
      latest: "current sandbox image",
      status: drifted > 0 ? "behind" : "ok",
      detail: drifted > 0 ? `${drifted} of ${total} sandbox(es) are on an outdated image.`
        : (total > 0 ? `All ${total} sandbox(es) on the current image.` : "No running sandboxes."),
      update: drifted > 0
        ? {
          action: "migrate-all", label: `Migrate ${drifted} sandbox(es) — no data loss`, data_safe: true,
          note: "Zero-drift swap: same volume + same id, ~40s each; busy boxes are retried. No user data is lost."
        }
        : null,
    });
  } catch (e) { systems.push({ id: "sandboxes", name: "Sandboxes — running boxes", kind: "sandboxes", status: "error", detail: `Orchestrator unreachable: ${e.message}`, update: null }); }

  // 5) Sandbox images — the templates the orchestrator spawns from. A missing
  //    REQUIRED image means spawning that template fails. Rebuild is heavy +
  //    streamed, so the action routes to the Sandboxes page (live build logs).
  try {
    const variants = Object.entries(SANDBOX_IMAGE_VARIANTS).map(([variant, spec]) => ({ variant, required: spec.required === true, ...inspectImage(spec.tag) }));
    const missingRequired = variants.filter((v) => v.required && !v.present).map((v) => v.variant);
    const present = variants.filter((v) => v.present).length;
    systems.push({
      id: "sandbox-images", name: "Sandbox images (templates)", kind: "sandbox-images",
      current: `${present}/${variants.length} built`,
      latest: `${variants.filter((v) => v.required).length} required`,
      status: missingRequired.length ? "behind" : "ok",
      detail: missingRequired.length
        ? `Missing required image(s): ${missingRequired.join(", ")}. Sandboxes that spawn from these will fail until rebuilt.`
        : `All required images present (${variants.filter((v) => v.present).map((v) => v.variant).join(", ")}).`,
      images: variants.map((v) => ({ variant: v.variant, required: v.required, present: v.present })),
      missing_required: missingRequired,
      update: missingRequired.length
        ? {
          action: "sandbox-image-rebuild", label: `Rebuild image(s): ${missingRequired.join(", ")}`, data_safe: true,
          note: "Opens the Sandboxes page where each image rebuilds with live logs (the aidream image is large and builds on top of core)."
        }
        : null,
    });
  } catch (e) { systems.push({ id: "sandbox-images", name: "Sandbox images (templates)", kind: "sandbox-images", status: "error", detail: String(e.message), update: null }); }

  const overall = systems.some((s) => s.status === "behind") ? "behind"
    : systems.some((s) => s.status === "error") ? "error" : "ok";
  return { overall, systems, generated_at: new Date().toISOString(), repo };
}

app.get("/api/versions", authMiddleware, async (_req, res) => {
  try { res.json(await buildVersionsReport()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Migrate ONE box onto the current image (same id + volume, no data loss). Role-gated.
app.post("/api/orchestrator-sandboxes/:id/migrate", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const q = req.query.target_image ? `?target_image=${encodeURIComponent(String(req.query.target_image))}` : "";
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/migrate${q}`, { method: "POST" });
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Live resource stats for a box — CPU / memory / disk + whether the in-box
// agent daemon is alive. Hosted boxes are local containers, so we read this
// straight off the local docker socket (no orchestrator round-trip). ec2-tier
// boxes run on a remote host and report available:false.
app.get("/api/orchestrator-sandboxes/:id/stats", authMiddleware, async (req, res) => {
  const id = String(req.params.id);
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return res.status(400).json({ error: "invalid sandbox id" });
  const running = exec(`docker inspect ${id} --format '{{.State.Running}}' 2>/dev/null`);
  if (!running.success || running.output.trim() !== "true") {
    return res.json({ available: false, reason: "container is not running on this host (ec2-tier boxes run remotely)" });
  }
  const s = exec(`docker stats ${id} --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","mem_pct":"{{.MemPerc}}","pids":"{{.PIDs}}"}' 2>/dev/null`);
  let stats = null; try { stats = JSON.parse(s.output); } catch { /* */ }
  let disk = null;
  const df = exec(`docker exec ${id} sh -c "df -Ph /home/agent | tail -1" 2>/dev/null`);
  if (df.success && df.output) {
    const p = df.output.trim().split(/\s+/); // FS Size Used Avail Use% Mounted
    if (p.length >= 5) disk = { size: p[1], used: p[2], avail: p[3], use_pct: p[4] };
  }
  // Is the in-box matrx_agent daemon (port 8000) actually answering?
  const agent = exec(`docker exec ${id} sh -c "curl -sf -m 2 http://localhost:8000/health >/dev/null 2>&1 && echo up || (pgrep -f matrx_agent >/dev/null 2>&1 && echo proc || echo down)" 2>/dev/null`);
  res.json({
    available: true,
    cpu: stats?.cpu ?? null,
    mem: stats?.mem ?? null,
    mem_pct: stats?.mem_pct ?? null,
    pids: stats?.pids ?? null,
    disk,
    agent: agent.success && agent.output ? agent.output.trim() : "unknown",
  });
});

// Agent env — three views of the env vars actually visible inside the container
app.get("/api/orchestrator-sandboxes/:id/agent-env", authMiddleware, requireSuperadmin, async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/agent-env`);
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// Agent filesystem — same /fs/list endpoint matrx-ai's fs_list tool calls
app.get("/api/orchestrator-sandboxes/:id/fs/list", authMiddleware, async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const path = String(req.query.path || "/home/agent");
  const depth = String(req.query.depth || "1");
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/fs/list?path=${encodeURIComponent(path)}&depth=${encodeURIComponent(depth)}`);
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

app.get("/api/orchestrator-sandboxes/:id/fs/read", authMiddleware, async (req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  const path = String(req.query.path || "");
  if (!path) return res.status(400).json({ error: "path query param required" });
  const encoding = req.query.encoding === "base64" ? "base64" : "utf8";
  try {
    const r = await orchFetchForSandbox(req.params.id, `/sandboxes/${encodeURIComponent(req.params.id)}/fs/read?path=${encodeURIComponent(path)}&encoding=${encoding}`);
    res.status(r.status).type(r.headers.get("content-type") || "text/plain").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

app.get("/api/orchestrator-sandboxes-status", authMiddleware, async (_req, res) => {
  if (!ORCH_KEY) return res.status(503).json({ error: "Orchestrator API key not configured" });
  try {
    const r = await orchFetch("/");
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: `Orchestrator unreachable: ${e.message}` }); }
});

// ── Sandbox image health (read-only) — powers the "missing tag" banner ──────
app.get("/api/sandbox-images/health", authMiddleware, async (_req, res) => {
  const images = Object.entries(SANDBOX_IMAGE_VARIANTS).map(([variant, spec]) => ({
    variant,
    required: spec.required === true,
    ...inspectImage(spec.tag),
  }));
  const orchestrator = inspectImage(ORCH_IMAGE_TAG);
  // `missing` = every absent variant (informational). `missing_required` =
  // absent variants the orchestrator actually spawns from (+ the orchestrator
  // image) — this is the real "spawning is/'ll-be broken" alarm the banner uses.
  const missing = images.filter((i) => !i.present).map((i) => i.variant);
  // A variant that's missing BUT currently rebuilding shouldn't count as a
  // "required missing" alarm — it's mid-fix. Surface those separately as
  // `rebuilding` so the banner can say "rebuilding…" instead of "missing".
  const rebuilding = [];
  const missing_required = images
    .filter((i) => i.required && !i.present)
    .filter((i) => { const b = imageBuildInProgress(i.variant); if (b) { rebuilding.push(b); return false; } return true; })
    .map((i) => i.variant);
  if (!orchestrator.present && !imageBuildInProgress("orchestrator")) missing_required.push("orchestrator");
  res.json({ images, orchestrator, missing, missing_required, rebuilding, checked_at: new Date().toISOString() });
});

// ── Fleet Health (read-only monitor) ────────────────────────────────────────
// The thing that should have caught stale code / failed deploys / stale images
// weeks ago. Read-only: it changes nothing it watches. Three checks, each green
// /warn/critical with specifics; the worst rolls up to `overall`.
const IMAGE_STALE_DAYS = Number(process.env.MATRX_IMAGE_STALE_DAYS || 14);

async function fetchOrchestratorRoot(url) {
  // Public `/` — no auth. Returns the bits we diff for drift.
  const r = await fetch(`${url}/`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const ap = (d.integrations && d.integrations.aidream_passthrough) || {};
  return { version: d.version, tier: d.tier, passthrough_total: ap.total_keys, passthrough_configured: ap.configured_count };
}

async function checkOrchestratorDrift() {
  // Freshness is judged by GIT COMMIT vs origin/main — NOT the version string
  // (which has been reset across commits and is therefore meaningless for
  // "newer/older"). See getSandboxRepoState.
  let hosted, ec2, hErr, eErr;
  try { hosted = await fetchOrchestratorRoot(ORCH_URL); } catch (e) { hErr = e.message; }
  try { ec2 = await fetchOrchestratorRoot(EC2_ORCH_URL); } catch (e) { eErr = e.message; }
  const repo = await getSandboxRepoState();
  const actions = [];
  if (hErr) {
    return {
      id: "orchestrator-drift", label: "Orchestrator freshness", status: "critical",
      detail: `Hosted orchestrator unreachable: ${hErr}`,
      hosted, ec2, repo,
      actions: [
        { label: "Restart hosted orchestrator", action: "orch-restart", data_safe: true, note: "Recreates the matrx-orchestrator container. No user data on it." },
        { label: "Pull + rebuild + restart", action: "orch-pull-redeploy", data_safe: true, note: "git pull /srv clone to origin/main, rebuild image, recreate container." },
      ],
    };
  }

  const warnings = [];

  // Hosted: built from the /srv clone — flag if that's behind origin/main.
  if (repo.hostedBehind === true) {
    warnings.push(`Hosted orchestrator is built from a /srv clone that is behind origin/main (${repo.hostedShort} vs ${repo.mainShort}).`);
    actions.push({ label: "Pull + rebuild hosted orchestrator", action: "orch-pull-redeploy", data_safe: true, note: "git pull /srv clone to origin/main, rebuild image, recreate container. No user data on the orchestrator." });
  }
  // EC2: GHA-deployed — flag if the last successful deploy isn't origin/main.
  if (eErr) {
    warnings.push(`EC2 orchestrator unreachable (${eErr}).`);
    actions.push({ label: "Trigger GitHub Deploy (EC2)", action: "ec2-trigger-deploy", data_safe: true, note: "Dispatches the matrx-sandbox 'Deploy' workflow on main; redeploys EC2 in ~3-5 min via SSM." });
  } else if (repo.ec2Behind === true) {
    warnings.push(`EC2's last successful deploy (${repo.deployShort}) is behind origin/main (${repo.mainShort}).`);
    actions.push({ label: "Trigger GitHub Deploy (EC2)", action: "ec2-trigger-deploy", data_safe: true, note: "Dispatches the matrx-sandbox 'Deploy' workflow on main; redeploys EC2 in ~3-5 min via SSM." });
  }
  if (repo.deployFailures) {
    warnings.push(`${repo.deployFailures} of the last 5 matrx-sandbox deploys failed.`);
  }
  // AI Dream secret passthrough on EC2 (known, accepted gap) — warning only.
  if (!eErr && ec2 && ec2.passthrough_configured === 0) {
    warnings.push(`EC2 has no AI Dream secrets loaded — only the EC2 "AI Dream baked-in" sandboxes are affected; slim + the co-located backend are fine.`);
  }

  const status = warnings.length ? "warning" : "ok";
  const detail = warnings.join("; ") || "Orchestrators are on origin/main. (Version numbers reported by each tier are not freshness signals.)";
  return { id: "orchestrator-drift", label: "Orchestrator freshness", status, detail, hosted, ec2, repo, actions };
}

function checkSandboxImages() {
  const now = Date.now();
  const imgs = Object.entries(SANDBOX_IMAGE_VARIANTS).map(([variant, spec]) => {
    const info = inspectImage(spec.tag);
    const ageDays = info.present && info.created ? Math.floor((now - Date.parse(info.created)) / 86400000) : null;
    return { variant, required: spec.required === true, present: info.present, age_days: ageDays };
  });
  const orch = inspectImage(ORCH_IMAGE_TAG);
  // Split missing-required into "actually missing" vs "missing but rebuilding
  // right now" (a deploy-hosted run or a UI rebuild left a fresh build marker).
  // A rebuilding image is mid-fix, NOT a critical alarm — show progress instead.
  const rebuilding = [];
  const missingRequired = [];
  for (const i of imgs.filter((x) => x.required && !x.present)) {
    const b = imageBuildInProgress(i.variant);
    if (b) rebuilding.push(b); else missingRequired.push(i.variant);
  }
  if (!orch.present) { const b = imageBuildInProgress("orchestrator"); if (b) rebuilding.push(b); else missingRequired.push("orchestrator"); }
  const staleRequired = imgs.filter((i) => i.required && i.present && i.age_days != null && i.age_days > IMAGE_STALE_DAYS).map((i) => `${i.variant} (${i.age_days}d)`);
  let status = "ok", detail = "All required images present and fresh.";
  const actions = [];
  if (missingRequired.length) {
    status = "critical";
    detail = `Missing required image(s): ${missingRequired.join(", ")}. Sandboxes that spawn from these will fail until rebuilt.`;
    if (rebuilding.length) detail += ` (Also rebuilding now: ${rebuilding.map((b) => `${b.variant} ${b.age_seconds}s`).join(", ")}.)`;
    // One button per missing variant — each takes the user to the live-log
    // rebuild page (the build is heavy + streamed; one-shot wouldn't give
    // useful feedback).
    for (const v of missingRequired) {
      actions.push({
        label: `Rebuild ${v} image`,
        action: "sandbox-image-rebuild",
        variant: v,
        data_safe: true,
        note: `Opens the Sandboxes page where ${v} rebuilds with live build logs.`,
      });
    }
  } else if (rebuilding.length) {
    // Nothing permanently missing — just builds in flight. Surface as a calm
    // "in progress" warning so the banner shows movement, not a red alarm.
    status = "warning";
    detail = `Rebuilding sandbox image(s): ${rebuilding.map((b) => `${b.variant} (${b.age_seconds}s, via ${b.source})`).join(", ")}. This clears automatically when the build finishes.`;
  } else if (staleRequired.length) {
    status = "warning";
    detail = `Stale required image(s) older than ${IMAGE_STALE_DAYS}d: ${staleRequired.join(", ")} — consider rebuilding.`;
    for (const entry of staleRequired) {
      const v = entry.split(" ")[0];
      actions.push({ label: `Rebuild ${v} image`, action: "sandbox-image-rebuild", variant: v, data_safe: true, note: `Opens the Sandboxes page where ${v} rebuilds with live logs.` });
    }
  }
  return { id: "sandbox-images", label: "Sandbox image freshness", status, detail, images: imgs, rebuilding, actions };
}

async function checkRecentDeploys() {
  const token = process.env.GITHUB_PAT || process.env.GH_TOKEN || "";
  if (!token) return { id: "deploys", label: "Recent deploys (matrx-sandbox)", status: "unknown", detail: "GITHUB_PAT not set in the Manager env — deploy-status check disabled.", actions: [] };
  try {
    const r = await fetch("https://api.github.com/repos/armanisadeghi/matrx-sandbox/actions/workflows/deploy.yml/runs?per_page=5", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "matrx-manager" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { id: "deploys", label: "Recent deploys (matrx-sandbox)", status: "warning", detail: `GitHub API ${r.status}`, actions: [] };
    const runs = ((await r.json()).workflow_runs || []).filter((x) => x.status === "completed");
    if (!runs.length) return { id: "deploys", label: "Recent deploys (matrx-sandbox)", status: "ok", detail: "No completed deploy runs found.", actions: [] };
    const latest = runs[0];
    const failures = runs.filter((x) => x.conclusion === "failure").length;
    let status = "ok", detail = `Latest deploy ${latest.conclusion} (${(latest.head_sha || "").slice(0, 7)}, ${latest.created_at?.slice(0, 16)}).`;
    const actions = [];
    if (latest.conclusion === "failure") {
      status = "critical";
      detail = `Latest deploy FAILED (${(latest.head_sha || "").slice(0, 7)}, ${latest.created_at?.slice(0, 16)}) — EC2 may be running older code.`;
      actions.push({ label: "Trigger new GitHub Deploy", action: "ec2-trigger-deploy", data_safe: true, note: "Dispatches the matrx-sandbox 'Deploy' workflow on main; redeploys EC2 in ~3-5 min via SSM." });
      if (latest.html_url) actions.push({ label: "View failed run on GitHub", action: "open-url", url: latest.html_url });
    } else if (failures) {
      status = "warning";
      detail = `Latest deploy ok, but ${failures} of last ${runs.length} failed.`;
    }
    return { id: "deploys", label: "Recent deploys (matrx-sandbox)", status, detail, runs: runs.map((x) => ({ conclusion: x.conclusion, sha: (x.head_sha || "").slice(0, 7), at: x.created_at, url: x.html_url })), actions };
  } catch (e) {
    return { id: "deploys", label: "Recent deploys (matrx-sandbox)", status: "warning", detail: `Deploy check failed: ${e.message}`, actions: [] };
  }
}

app.get("/api/fleet-health", authMiddleware, async (_req, res) => {
  const [drift, deploys] = await Promise.all([checkOrchestratorDrift(), checkRecentDeploys()]);
  const images = checkSandboxImages();
  const checks = [drift, images, deploys];
  const rank = { ok: 0, unknown: 0, warning: 1, critical: 2 };
  const worst = checks.reduce((m, c) => Math.max(m, rank[c.status] ?? 0), 0);
  const overall = worst >= 2 ? "critical" : worst === 1 ? "degraded" : "ok";
  res.json({ overall, checks, checked_at: new Date().toISOString() });
});

// Wait for the hosted orchestrator's `/` to respond 200. The Manager hits this
// after a recreate so the UI sees "ready" before it tries the next call (and
// stops surfacing the brief Traefik 404 / connection-refused window).
async function waitForOrchestratorReady(url = ORCH_URL, totalMs = 30000, stepMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    try {
      const r = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return { ready: true, waited_ms: Date.now() - start };
    } catch { /* still booting */ }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return { ready: false, waited_ms: Date.now() - start };
}

// Public readiness probe — the UI calls this AFTER a rebuild/recreate to know
// when it's safe to refresh the rest of the page without hitting the brief
// post-recreate "Orchestrator 404 page not found" (which is just Traefik
// returning its default 404 before the new container is registered).
app.get("/api/orchestrator/ready", authMiddleware, async (req, res) => {
  const target = req.query.target === "ec2" ? EC2_ORCH_URL : ORCH_URL;
  const totalMs = Math.min(60000, Math.max(1000, Number(req.query.wait_ms) || 30000));
  const r = await waitForOrchestratorReady(target, totalMs);
  res.status(r.ready ? 200 : 504).json({ ...r, target });
});

// Hosted orchestrator PROCESS logs (the orchestrator's own stdout/stderr).
// Distinct from per-sandbox-container logs (those go via /sandboxes/{id}/logs).
// This is what you need when an "auto-provision created the DB row but the
// container failed to start" — the Docker container-startup error lives here.
//
// CAVEAT: logs are scoped to the CURRENT orchestrator container's lifetime.
// A force-recreate destroys the prior container's log file. We surface
// `container_started_at` so the caller knows the lookback window.
app.get("/api/orchestrator/logs", authMiddleware, async (req, res) => {
  const since = String(req.query.since || "24h"); // e.g. 1h, 30m, 7d
  const tail = Math.min(5000, Math.max(50, Number(req.query.tail) || 1000));
  const grep = req.query.grep ? String(req.query.grep) : null;
  const format = req.query.format === "json" ? "json" : "text";

  // When the container was created — defines the actual lookback floor.
  const startedAt = exec(`docker inspect matrx-orchestrator --format '{{.State.StartedAt}}'`).output?.trim() || null;

  // `docker compose logs --since` accepts go-style durations (e.g. "1h").
  const cmd = `docker compose logs --no-color --since ${since} --tail ${tail} orchestrator 2>&1`;
  const r = exec(cmd, { cwd: ORCH_COMPOSE_DIR, timeout: 30000, maxBuffer: 30 * 1024 * 1024 });
  let text = r.output || "";
  // Strip the "matrx-orchestrator  | " prefix that compose adds to each line,
  // so callers can grep on the JSON payload directly.
  text = text.split("\n").map((l) => l.replace(/^matrx-orchestrator\s+\|\s?/, "")).join("\n");
  if (grep) {
    try {
      const re = new RegExp(grep, "i");
      text = text.split("\n").filter((l) => re.test(l)).join("\n");
    } catch (e) { return res.status(400).json({ error: `Bad grep regex: ${e.message}` }); }
  }

  if (format === "json") {
    res.json({
      container: "matrx-orchestrator",
      container_started_at: startedAt,
      since, tail, grep,
      lines: text.split("\n").filter(Boolean),
      truncated_note: "Logs are scoped to the current orchestrator container's lifetime. Force-recreate destroys the prior container's log file.",
    });
  } else {
    const header = `# matrx-orchestrator process logs · container started ${startedAt || "?"} · since=${since} · tail=${tail}${grep ? ` · grep=/${grep}/i` : ""}\n`;
    res.type("text/plain").send(header + text);
  }
});

// ── Restart the orchestrator (recreate container, no rebuild) ───────────────
app.post("/api/orchestrator/restart", authMiddleware, requireRole("admin", "deployer"), async (_req, res) => {
  const r = exec("docker compose up -d --force-recreate", { cwd: ORCH_COMPOSE_DIR, timeout: 120000 });
  _sbxRepoCache = { ts: 0, data: null };
  const ready = await waitForOrchestratorReady();
  res.status(r.success ? 200 : 500).json({ ...r, ready });
});

// ── Redeploy the orchestrator: rebuild image from source + recreate (one-shot,
// non-streamed — used by the Versions "Update" button). No user data on the
// orchestrator, so this is safe. ────────────────────────────────────────────
app.post("/api/orchestrator/redeploy", authMiddleware, requireSuperadmin, async (_req, res) => {
  const context = join(SANDBOX_PROJECT, "orchestrator");
  const build = exec(`docker build -t ${ORCH_IMAGE_TAG} ${context}`, { cwd: context, timeout: 300000 });
  if (!build.success) return res.status(500).json({ success: false, step: "build", error: build.error || build.output });
  const recreate = exec("docker compose up -d --force-recreate", { cwd: ORCH_COMPOSE_DIR, timeout: 120000 });
  _sbxRepoCache = { ts: 0, data: null };
  const ready = await waitForOrchestratorReady();
  res.status(recreate.success ? 200 : 500).json({ success: recreate.success, step: recreate.success ? "done" : "recreate", output: recreate.output || recreate.error, ready });
});

// Pull the /srv matrx-sandbox clone to origin/main, then rebuild + recreate the
// hosted orchestrator. Fixes "hosted source behind origin". superadmin.
app.post("/api/orchestrator/pull-redeploy", authMiddleware, requireSuperadmin, async (req, res) => {
  const pull = exec(`git -C ${SANDBOX_PROJECT} fetch origin main && git -C ${SANDBOX_PROJECT} reset --hard origin/main`, { timeout: 120000 });
  if (!pull.success) return res.status(500).json({ success: false, step: "git-pull", error: pull.error || pull.output });
  _sbxRepoCache = { ts: 0, data: null };
  const context = join(SANDBOX_PROJECT, "orchestrator");
  const build = exec(`docker build -t ${ORCH_IMAGE_TAG} ${context}`, { cwd: context, timeout: 300000 });
  if (!build.success) return res.status(500).json({ success: false, step: "build", error: build.error || build.output });
  const recreate = exec("docker compose up -d --force-recreate", { cwd: ORCH_COMPOSE_DIR, timeout: 120000 });
  _sbxRepoCache = { ts: 0, data: null };
  const ready = await waitForOrchestratorReady();
  try { auditLog(req.tokenEntry?.label || "manager", "orch_pull_redeploy", "hosted", {}); } catch { /* */ }
  res.status(recreate.success ? 200 : 500).json({ success: recreate.success, step: recreate.success ? "done" : "recreate", pulled: pull.output, output: recreate.output || recreate.error, ready });
});

// Trigger the matrx-sandbox 'Deploy' GitHub Actions workflow on main (redeploys
// the EC2 orchestrator via SSM). superadmin.
app.post("/api/ec2/trigger-deploy", authMiddleware, requireSuperadmin, async (req, res) => {
  const pat = process.env.GITHUB_PAT || "";
  if (!pat) return res.status(503).json({ error: "GITHUB_PAT not configured on the Manager" });
  try {
    const r = await fetch("https://api.github.com/repos/armanisadeghi/matrx-sandbox/actions/workflows/deploy.yml/dispatches", {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    });
    if (r.status !== 204) { const t = await r.text(); return res.status(502).json({ error: `GitHub dispatch failed: ${r.status} ${t.slice(0, 200)}` }); }
    _sbxRepoCache = { ts: 0, data: null };
    try { auditLog(req.tokenEntry?.label || "manager", "ec2_trigger_deploy", "matrx-sandbox", {}); } catch { /* */ }
    res.json({ ok: true, message: "Deploy workflow dispatched on main. Watch GitHub Actions; the EC2 orchestrator updates in ~3-5 min." });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── SSE helper for streamed builds (mirrors /api/rebuild/stream) ────────────
function streamSpawn(res, { cmd, args, cwd, onDoneLog }) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("phase", { phase: "build", message: `Running: ${cmd} ${args.join(" ")}` });
  const proc = spawn(cmd, args, { cwd, env: { ...process.env, DOCKER_BUILDKIT: "1" } });
  const relay = (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) send("log", { message: line });
  };
  proc.stdout.on("data", relay);
  proc.stderr.on("data", relay);
  proc.on("close", (code) => {
    if (code === 0) {
      if (onDoneLog) send("log", { message: onDoneLog });
      send("done", { success: true });
    } else {
      send("error", { success: false, message: `Exited with code ${code}` });
    }
    res.end();
  });
  proc.on("error", (err) => { send("error", { success: false, message: err.message }); res.end(); });
}

// ── Rebuild the orchestrator image + recreate (SSE) ─────────────────────────
app.post("/api/orchestrator/build/stream", authMiddleware, requireRole("admin"), async (_req, res) => {
  const context = join(SANDBOX_PROJECT, "orchestrator");
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("phase", { phase: "build", message: `Building ${ORCH_IMAGE_TAG} from ${context}` });
  const proc = spawn("docker", ["build", "--progress=plain", "-t", ORCH_IMAGE_TAG, context], { env: { ...process.env, DOCKER_BUILDKIT: "1" } });
  const relay = (c) => { for (const l of c.toString().split("\n").filter(Boolean)) send("log", { message: l }); };
  proc.stdout.on("data", relay);
  proc.stderr.on("data", relay);
  proc.on("close", (code) => {
    if (code !== 0) { send("error", { success: false, message: `Build exited with code ${code}` }); return res.end(); }
    // Bring the shared sandbox DB schema forward BEFORE the new orchestrator
    // serves traffic — same order as scripts/deploy-hosted.sh. Skipping this
    // is how the schema fell behind the code (2026-07: user_memory missing).
    // Idempotent via the schema_migrations ledger.
    send("phase", { phase: "migrate", message: "Applying DB migrations (orchestrator.migrate_runner)..." });
    const m = exec(`docker run --rm --env-file ${ORCH_COMPOSE_DIR}/.env ${ORCH_IMAGE_TAG} python -m orchestrator.migrate_runner`, { timeout: 120000 });
    if (!m.success) { send("error", { success: false, message: `DB migrations failed — orchestrator NOT recreated (old container keeps serving): ${m.error || "unknown"}` }); return res.end(); }
    send("phase", { phase: "restart", message: "Recreating orchestrator container..." });
    const r = exec("docker compose up -d --force-recreate", { cwd: ORCH_COMPOSE_DIR, timeout: 120000 });
    send(r.success ? "done" : "error", { success: r.success, message: r.success ? "Orchestrator rebuilt + migrated + recreated" : (r.error || "recreate failed") });
    res.end();
  });
  proc.on("error", (err) => { send("error", { success: false, message: err.message }); res.end(); });
});

// ── Rebuild a sandbox image variant (SSE) ───────────────────────────────────
app.post("/api/sandbox-images/build/stream", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  const variant = String(req.query.variant || req.body?.variant || "");
  const spec = SANDBOX_IMAGE_VARIANTS[variant];
  if (!spec) {
    return res.status(400).json({ error: `Unknown variant '${variant}'. Valid: ${Object.keys(SANDBOX_IMAGE_VARIANTS).join(", ")}` });
  }
  if (spec.script) {
    // aidream: run the repo's build script (stages an aidream checkout, needs :core).
    return streamSpawn(res, { cmd: "bash", args: [spec.script], cwd: dirname(spec.script), onDoneLog: `Built ${spec.tag}` });
  }
  const args = ["build", "--progress=plain", "-t", spec.tag];
  if (spec.dockerfile) args.push("-f", join(spec.context, spec.dockerfile));
  args.push(spec.context);
  streamSpawn(res, { cmd: "docker", args, onDoneLog: `Built ${spec.tag}` });
});

// ── Rebuild EVERY missing required sandbox image, in dependency order (SSE) ──
// This is what the "Rebuild now" banner + "Rebuild aidream image" Fleet Health
// button actually call. Builds matrx-sandbox:core first (aidream depends on
// it), then any other required variant that's absent. Streams every step
// into ONE SSE stream so the operator sees a single linear progress log
// instead of having to chain button-clicks themselves.
//
// LOCK: only one rebuild-missing chain can run at a time per Manager process.
// Two concurrent runs (e.g. a stale browser tab + a fresh click) race the
// build-aidream.sh staging dir (rm -rf scripts-local; mkdir; cp ...) and one
// dies with "cp: File exists". Module-scoped flag refused as 409.
let _imgRebuildInFlight = null; // { variant, started_at }
app.post("/api/sandbox-images/rebuild-missing/stream", authMiddleware, requireRole("admin", "deployer"), async (req, res) => {
  if (_imgRebuildInFlight) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`event: error\ndata: ${JSON.stringify({ success: false, message: `Another sandbox-image rebuild is already running (variant=${_imgRebuildInFlight.variant || "all"}, started ${_imgRebuildInFlight.started_at}). Wait for it to finish.` })}\n\n`);
    return res.end();
  }
  // Lock is held by the SUBPROCESS, not the response. We track the running
  // child via _imgRebuildInFlight.proc so client disconnects don't orphan the
  // build (the subprocess keeps running) and concurrent calls are still
  // refused until that subprocess actually exits.
  _imgRebuildInFlight = { variant: String(req.query.variant || "").trim() || "all", started_at: new Date().toISOString(), proc: null };
  // If the client aborts, kill the running docker build so the lock can
  // release promptly and we don't have orphan builds chewing CPU.
  const onClientGone = () => { try { _imgRebuildInFlight?.proc?.kill("SIGTERM"); } catch { /* */ } };
  res.on("close", onClientGone);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Figure out what to build. `variant` (optional query param) lets the caller
  // request a specific image; if omitted we build EVERY missing required one.
  const requested = String(req.query.variant || "").trim();
  const orderAll = ["core", "slim", "aidream", "local"]; // dependency-correct order
  const wantedSet = requested ? new Set([requested]) : new Set(orderAll.filter((v) => {
    const s = SANDBOX_IMAGE_VARIANTS[v];
    return s && (s.required || (requested === "" && false));
  }));
  // aidream NEEDS core — add it to the queue if we're building aidream and core is missing.
  if (wantedSet.has("aidream") && !inspectImage(SANDBOX_IMAGE_VARIANTS.core.tag).present) {
    wantedSet.add("core");
  }
  const queue = orderAll.filter((v) => wantedSet.has(v));
  if (queue.length === 0) {
    send("done", { success: true, message: "Nothing to build — all required images present." });
    _imgRebuildInFlight = null;
    return res.end();
  }
  send("phase", { phase: "plan", message: `Will build: ${queue.join(", ")}` });

  // Run each build sequentially, capturing exit codes. If any step fails we
  // stop the chain and report the failing variant so the operator can see it.
  let overallOk = true;
  for (const v of queue) {
    const spec = SANDBOX_IMAGE_VARIANTS[v];
    if (!spec) { send("log", { message: `(skip unknown variant: ${v})` }); continue; }
    // Skip if already present and the caller didn't explicitly ask for this variant.
    if (!requested && inspectImage(spec.tag).present) {
      send("log", { message: `✓ ${spec.tag} already present — skipping.` });
      continue;
    }
    send("phase", { phase: "build", message: `── Building ${spec.tag} ──` });
    // Drop a build marker so Fleet Health shows "rebuilding…" (not a false
    // "missing" critical) for the whole duration of this UI-triggered build.
    markImageBuild(v, "manager-ui");
    const ok = await new Promise((resolve) => {
      let cmd, args, cwd;
      if (spec.script) {
        cmd = "bash";
        args = [spec.script];
        cwd = dirname(spec.script);
      } else {
        cmd = "docker";
        args = ["build", "--progress=plain", "-t", spec.tag];
        if (spec.dockerfile) args.push("-f", join(spec.context, spec.dockerfile));
        args.push(spec.context);
        cwd = spec.context;
      }
      const proc = spawn(cmd, args, { cwd, env: { ...process.env, DOCKER_BUILDKIT: "1" } });
      // Expose the subprocess on the lock so client-disconnect can kill it
      // (and so concurrent callers stay refused until the build truly ends).
      if (_imgRebuildInFlight) _imgRebuildInFlight.proc = proc;
      const relay = (chunk) => { for (const line of chunk.toString().split("\n").filter(Boolean)) send("log", { message: line }); };
      proc.stdout.on("data", relay);
      proc.stderr.on("data", relay);
      proc.on("close", (code) => {
        if (_imgRebuildInFlight) _imgRebuildInFlight.proc = null;
        clearImageBuild(v);
        if (code === 0) { send("log", { message: `✓ Built ${spec.tag}` }); resolve(true); }
        else { send("log", { message: `✗ ${spec.tag} build failed with exit ${code}` }); resolve(false); }
      });
      proc.on("error", (err) => { clearImageBuild(v); send("log", { message: `✗ ${err.message}` }); resolve(false); });
    });
    if (!ok) { overallOk = false; break; }
  }
  if (overallOk) send("done", { success: true, message: `All required images built: ${queue.join(", ")}.` });
  else send("error", { success: false, message: "Build chain stopped — see logs above." });
  // Release the lock now that the LAST subprocess in the chain has exited.
  // (Subscribers that already disconnected won't see the final event, but
  // the next /api/sandbox-images/health poll will reflect the new state.)
  _imgRebuildInFlight = null;
  res.end();
});

// ── Fleet hosts (AWS/SSM control plane) ─────────────────────────────────────
// The remote EC2 boxes the Manager can reach via SSM. "this" is the local /srv
// host (managed directly via the docker socket + shell_exec, not SSM). A1 ships
// remote command execution; A2 adds terminals; A5 formalizes the registry.

// GET /api/hosts — list the fleet + live SSM/EC2 status.
app.get("/api/hosts", authMiddleware, async (_req, res) => {
  if (!awsConfigured()) {
    return res.status(503).json({ error: "AWS not configured on the Manager (set MATRX_ADMIN_AWS_* in /srv/apps/server-manager/.env)", aws_configured: false });
  }
  try {
    const [ssm, ec2] = await Promise.all([
      ssmInstances().catch(() => []),
      ec2Describe(Object.values(FLEET_HOSTS).map((h) => h.instanceId)).catch(() => []),
    ]);
    const ssmById = Object.fromEntries(ssm.map((i) => [i.instanceId, i]));
    const ec2ById = Object.fromEntries(ec2.map((i) => [i.instanceId, i]));
    const hosts = Object.entries(FLEET_HOSTS).map(([name, h]) => ({
      id: name,
      role: h.role,
      instanceId: h.instanceId,
      region: h.region,
      ssm: ssmById[h.instanceId] || null,
      ec2: ec2ById[h.instanceId] || null,
      online: ssmById[h.instanceId]?.ping === "Online",
    }));
    res.json({ aws_configured: true, region: awsRegion(), hosts });
  } catch (e) {
    res.status(502).json({ error: `AWS error: ${e.message}` });
  }
});

// POST /api/hosts/local/exec — run a shell command on the LOCAL /srv host.
// Body: { command, cwd?, timeout? }. Mirrors the shell_exec MCP tool (Docker
// CLI + /host-srv + /host-data in scope). admin/deployer; reverse-tag guarded.
// MUST be defined before /api/hosts/:id/exec so "local" isn't matched as an :id.
app.post("/api/hosts/local/exec", authMiddleware, requireSuperadmin, async (req, res) => {
  const command = String(req.body?.command || "").trim();
  if (!command) return res.status(400).json({ error: "command is required" });
  const blocked = guardDestructiveImageOp(command);
  if (blocked) return res.status(403).json(blocked);
  const timeout = Math.min(Number(req.body?.timeout) || 30000, 120000);
  const cwd = req.body?.cwd ? resolveHostPath(String(req.body.cwd)) : HOST_SRV;
  const result = exec(command, { timeout, cwd });
  try {
    auditLog(req.tokenEntry?.label || "manager", "local_exec", "host:/srv", { command: command.slice(0, 500), success: result.success, exitCode: result.exitCode });
  } catch { /* audit is best-effort */ }
  res.json({ host: "local", ...result });
});

// POST /api/hosts/:id/exec — run a shell command on a fleet host via SSM.
// Body: { command, timeout? }. Returns { status, stdout, stderr, exitCode }.
// SSM returns output at completion (not incrementally), so this is request/
// response — the UI shows a spinner, then the result. (Interactive shells come
// in A2 via SSM StartSession.)
app.post("/api/hosts/:id/exec", authMiddleware, requireSuperadmin, async (req, res) => {
  if (!awsConfigured()) return res.status(503).json({ error: "AWS not configured on the Manager" });
  const host = FLEET_HOSTS[req.params.id];
  if (!host) return res.status(404).json({ error: `Unknown host '${req.params.id}'. Known: ${Object.keys(FLEET_HOSTS).join(", ")}` });
  const command = String(req.body?.command || "").trim();
  if (!command) return res.status(400).json({ error: "command is required" });
  const timeout = Number(req.body?.timeout) || 120;
  try {
    const result = await ssmRun(host.instanceId, command, { timeout, comment: `manager:${req.tokenEntry?.label || "admin"}` });
    try {
      auditLog(req.tokenEntry?.label || "manager", "host_exec", req.params.id, { command: command.slice(0, 500), status: result.status, exitCode: result.exitCode });
    } catch { /* audit is best-effort */ }
    res.json({ host: req.params.id, instanceId: host.instanceId, ...result });
  } catch (e) {
    res.status(502).json({ error: `SSM error: ${e.message}` });
  }
});

// POST /api/hosts/:id/power — start/stop/reboot a fleet host (EC2). admin only.
app.post("/api/hosts/:id/power", authMiddleware, requireSuperadmin, async (req, res) => {
  if (!awsConfigured()) return res.status(503).json({ error: "AWS not configured on the Manager" });
  const host = FLEET_HOSTS[req.params.id];
  if (!host) return res.status(404).json({ error: `Unknown host '${req.params.id}'` });
  const action = String(req.body?.action || "");
  if (!["start", "stop", "reboot"].includes(action)) return res.status(400).json({ error: "action must be start, stop, or reboot" });
  try {
    await ec2Power(action, host.instanceId);
    try { auditLog(req.tokenEntry?.label || "manager", `host_power_${action}`, req.params.id, {}); } catch { /* */ }
    res.json({ host: req.params.id, action, ok: true });
  } catch (e) {
    res.status(502).json({ error: `EC2 error: ${e.message}` });
  }
});

// ── Local host + container command execution (no SSM, no new daemons) ───────
// The fleet /api/hosts/* routes reach the REMOTE EC2 boxes via SSM. These reach
// the LOCAL /srv host and every container on it — the same god-mode the Manager
// already has via the MCP shell_exec/docker_exec tools, surfaced over HTTP so
// the admin UI can "run a command anywhere" without SSH. Same auth + audit +
// reverse-tag guard. (Interactive PTY terminals are A2; this is one-shot exec.)

// GET /api/containers — every local container, each classified with what it is
// (title/description) + its category (for grouping). One source of truth shared
// with the agent-gw target catalog so the terminal picker, etc. all label + group
// identically.
app.get("/api/containers", authMiddleware, async (_req, res) => {
  const result = exec(`docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Label "matrx.template"}}\t{{.Label "matrx.warm_pool"}}'`);
  if (!result.success) return res.status(502).json({ error: result.error || "docker ps failed" });
  const displayNames = loadDisplayNames();
  const containers = result.output.split("\n").filter(Boolean).map((line) => {
    const [name, image, state, status, tmpl, warm] = line.split("\t");
    if (!name) return null;
    const d = classifyContainer(name, image, tmpl, warm === "1", displayNames);
    return { name, image, state, status, ...d };
  }).filter(Boolean);
  res.json({ containers, count: containers.length });
});

// POST /api/containers/:name/exec — run a command inside any local container.
// Body: { command, user?, workingDir?, timeout? }. Mirrors the docker_exec MCP
// tool. admin/deployer; reverse-tag guarded.
app.post("/api/containers/:name/exec", authMiddleware, requireSuperadmin, async (req, res) => {
  const name = String(req.params.name || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return res.status(400).json({ error: "invalid container name" });
  const command = String(req.body?.command || "").trim();
  if (!command) return res.status(400).json({ error: "command is required" });
  const blocked = guardDestructiveImageOp(command);
  if (blocked) return res.status(403).json(blocked);
  const timeout = Math.min(Number(req.body?.timeout) || 60000, 120000);
  // Validate the optional flags, then build the command with argv (no shell
  // string concatenation). Previously `workingDir` only stripped single quotes
  // and was interpolated unquoted, so `-w "/tmp && whoami #"` broke out to the host.
  const user = req.body?.user != null ? String(req.body.user) : null;
  const workingDir = req.body?.workingDir != null ? String(req.body.workingDir) : null;
  if (user != null && !/^[A-Za-z0-9_.:-]+$/.test(user)) return res.status(400).json({ error: "invalid user" });
  if (workingDir != null && !/^[A-Za-z0-9_./:-]+$/.test(workingDir)) return res.status(400).json({ error: "invalid workingDir" });
  const args = ["exec"];
  if (user) args.push("-u", user);
  if (workingDir) args.push("-w", workingDir);
  args.push(name, "sh", "-c", command);
  let result;
  try {
    const out = execFileSync("docker", args, { encoding: "utf-8", timeout, maxBuffer: 10 * 1024 * 1024 });
    result = { success: true, output: out.trim() };
  } catch (e) {
    result = { success: false, output: e.stdout?.trim() || "", error: e.stderr?.trim() || e.message, exitCode: e.status };
  }
  try {
    auditLog(req.tokenEntry?.label || "manager", "container_exec", `container:${name}`, { command: command.slice(0, 500), success: result.success, exitCode: result.exitCode });
  } catch { /* audit is best-effort */ }
  res.json({ container: name, ...result });
});

// ── Agent Gateway (real-infra agent access — "hijack the sandbox mechanism") ─
// The Manager mints a scoped, expiring HMAC token bound to one target (the /srv
// host or one container) and acts as the authenticated proxy for it. A matrx-ai
// consumer handed { base_url, access_token, root_path } runs its shell tools on
// real infra unchanged — the same binding shape sandboxes use, but pointed at
// the host. No unauthenticated daemon: auth is enforced here, on every call.
// Disabled unless AGENT_GW_SECRET (>=32 chars) is set. See agent_gateway.js +
// CONTROL_PLANE_PLAN.md Workstream B. exec.run ships now; fs/search follow.

// Run a command on a gateway target, returning matrx-ai's ExecResponse shape
// ({exit_code, stdout, stderr, cwd}) 1:1. host → local shell (Docker CLI +
// /host-srv in scope, same as shell_exec); container → docker exec.
function gwExecOnTarget(payload, { command, cwd, user, env, stdin, timeout }) {
  const target = parseTarget(payload.t);
  const rootPath = payload.r || (target.kind === "host" ? "/host-srv" : "/");
  const effCwd = cwd || rootPath;
  const tmo = Math.min(Math.max(Number(timeout) || 60, 1), 600) * 1000;
  const envExtra = env && typeof env === "object" ? env : {};
  const common = { encoding: "utf-8", timeout: tmo, maxBuffer: 10 * 1024 * 1024, input: stdin || undefined };
  try {
    let stdout;
    if (target.kind === "host") {
      stdout = execSync(command, { ...common, cwd: resolveHostPath(effCwd), env: { ...process.env, ...envExtra } });
    } else {
      const args = ["exec", "-i"];
      if (user) args.push("-u", String(user).replace(/[^A-Za-z0-9_.:-]/g, ""));
      if (effCwd) args.push("-w", String(effCwd));
      for (const [k, v] of Object.entries(envExtra)) args.push("-e", `${k}=${String(v)}`);
      args.push(target.name, "sh", "-c", command);
      stdout = execFileSync("docker", args, common);
    }
    return { exit_code: 0, stdout: stdout || "", stderr: "", cwd: effCwd };
  } catch (e) {
    return {
      exit_code: typeof e.status === "number" ? e.status : (e.code === "ETIMEDOUT" ? 124 : 1),
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || e.message || "",
      cwd: effCwd,
    };
  }
}

// Scoped-token auth for the public gateway routes (NOT the operator bearer
// token). Reads X-Sandbox-Access-Token and binds it to the URL's :target.
function agentGwAuth(req, res, next) {
  if (!gwEnabled()) return res.status(503).json({ error: "agent gateway disabled (AGENT_GW_SECRET unset)" });
  const token = req.headers["x-sandbox-access-token"] || "";
  try {
    req.gwPayload = verifyAgentToken(token, { requiredTarget: req.params.target });
    next();
  } catch (e) {
    res.status(e.code === "disabled" ? 503 : 401).json({ error: `gateway auth: ${e.message}`, code: e.code });
  }
}

// POST /api/agent-gw/grant — mint a binding for a target. admin only.
// Body: { target, root_path?, scopes?, ttl?, label? }. Returns the active_sandbox
// binding shape so it drops straight into AppContext.metadata["active_sandbox"].
// Human-readable "what is this thing" for a container, so an operator granting
// an agent access knows exactly what they're exposing. `danger` flags
// infrastructure where access ≈ control of the whole environment.
// Canonical grouping for the UI: a container's `kind` maps to a labelled
// category + sort order. ONE source of truth so the terminal picker, agent
// access, and any future list all group + label targets identically.
const KIND_CATEGORY = {
  host: { category: "server", categoryLabel: "Servers", order: 0 },
  "control-plane": { category: "control-plane", categoryLabel: "Control plane", order: 1 },
  proxy: { category: "infrastructure", categoryLabel: "Infrastructure", order: 2 },
  database: { category: "infrastructure", categoryLabel: "Infrastructure", order: 2 },
  "db-admin": { category: "infrastructure", categoryLabel: "Infrastructure", order: 2 },
  orchestrator: { category: "sandbox-system", categoryLabel: "Sandbox system", order: 3 },
  sandbox: { category: "sandbox", categoryLabel: "Sandboxes", order: 4 },
  "sandbox-legacy": { category: "sandbox", categoryLabel: "Sandboxes", order: 4 },
  "ship-instance": { category: "app", categoryLabel: "App deployments", order: 5 },
  "instance-db": { category: "database", categoryLabel: "Databases", order: 6 },
  "agent-env": { category: "agent-env", categoryLabel: "Agent environments", order: 7 },
  unknown: { category: "other", categoryLabel: "Other", order: 9 },
};
function categoryFor(kind) { return KIND_CATEGORY[kind] || KIND_CATEGORY.unknown; }

// describeContainer(...) + its category, in one object. Use this everywhere a
// target is listed so naming + grouping stay consistent.
function classifyContainer(name, image, tmpl, warm, displayNames) {
  const d = describeContainer(name, image, tmpl, warm, displayNames);
  return { ...d, ...categoryFor(d.kind) };
}

function loadDisplayNames() {
  const out = {};
  try {
    const dep = loadDeployments();
    const instances = dep?.instances || dep || {};
    for (const [k, v] of Object.entries(instances)) out[k] = (v && v.display_name) || k;
  } catch { /* best effort */ }
  return out;
}

function describeContainer(name, image, tmpl, warm, displayNames) {
  const display = (n) => displayNames[n] || n;
  const img = image || "";
  if (name === "traefik") return { kind: "proxy", title: "Traefik reverse proxy", description: "Routes ALL HTTPS traffic for *.dev.codematrx.com and manages TLS certs. Breaking it takes every site offline.", danger: true };
  if (name === "postgres") return { kind: "database", title: "Shared Postgres (pgvector)", description: "The main shared PostgreSQL database. Holds shared application data across projects.", danger: true };
  if (name === "pgadmin") return { kind: "db-admin", title: "pgAdmin", description: "Web UI for administering the Postgres databases.", danger: false };
  if (name === "matrx-manager") return { kind: "control-plane", title: "Server Manager — THIS control plane", description: "The brain of the host: manages every container, owns the deployments registry, holds the Docker socket. Access here ≈ control of the entire server.", danger: true };
  if (name === "matrx-deploy") return { kind: "control-plane", title: "Deploy Server (recovery lifeline)", description: "The safety net that can rebuild the Server Manager if it breaks. Keep it pristine.", danger: true };
  if (name === "matrx-orchestrator") return { kind: "orchestrator", title: "Sandbox Orchestrator (hosted tier)", description: "Spawns and manages the ephemeral sandbox containers that agents run in.", danger: true };
  if (name.startsWith("agent-") && img.includes("agent-envs")) return { kind: "agent-env", title: "Agent VM (sysbox)", description: "An isolated sysbox-based VM for agents — shell only, not wired into the app stack.", danger: false };
  if (name.startsWith("db-")) return { kind: "instance-db", title: `Database — ${display(name.slice(3))}`, description: `The PostgreSQL database for the "${display(name.slice(3))}" deployment. Contains that one app's data.`, danger: true };
  if (img.startsWith("matrx-sandbox") || tmpl) return { kind: "sandbox", title: warm ? "Sandbox (warm pool, idle)" : "Sandbox container", description: `An ephemeral agent sandbox${tmpl ? ` (template: ${tmpl})` : ""}.${warm ? " Unclaimed — waiting in the warm pool." : ""} A scratch machine, not infrastructure — safe to experiment in.`, danger: false };
  if (/^sandbox-\d+$/.test(name)) return { kind: "sandbox-legacy", title: "Starter-pool sandbox (deprecated)", description: "An old static sandbox (sandbox-1..5) that predates the orchestrator. Being retired.", danger: false };
  if (img === "matrx-ship:latest") return { kind: "ship-instance", title: `Ship app — ${display(name)}`, description: `A per-project Matrx Ship instance (version tracking + admin portal) for "${display(name)}", served at ${name}.dev.codematrx.com.`, danger: false };
  return { kind: "unknown", title: name, description: `Unrecognized container (image: ${img || "unknown"}).`, danger: false };
}

// GET /api/agent-gw/targets — the catalog of grantable targets (the /srv host +
// every container), each annotated with what it actually is. superadmin only.
app.get("/api/agent-gw/targets", authMiddleware, requireSuperadmin, (_req, res) => {
  const displayNames = loadDisplayNames();

  const targets = [{
    target: "host",
    name: "host",
    title: "The /srv host (this server)",
    description: "The dev server itself — full operator access to every config, compose file, and source repo under /srv. The highest-privilege target.",
    danger: true,
    image: "",
    state: "running",
    status: "",
    ...categoryFor("host"),
    kind: "host",
  }];

  const out = exec(`docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Label "matrx.template"}}\t{{.Label "matrx.warm_pool"}}'`);
  if (out.success) {
    for (const line of out.output.split("\n").filter(Boolean)) {
      const [name, image, state, status, tmpl, warm] = line.split("\t");
      if (!name) continue;
      const d = classifyContainer(name, image, tmpl, warm === "1", displayNames);
      targets.push({ target: `container:${name}`, name, image, state, status, ...d });
    }
  }
  // Group order first (server, control plane, infra, …), then danger, then name.
  targets.sort((a, b) =>
    (a.order - b.order) || (a.danger === b.danger ? a.name.localeCompare(b.name) : (a.danger ? -1 : 1)));
  res.json({ targets, count: targets.length });
});

app.post("/api/agent-gw/grant", authMiddleware, requireSuperadmin, (req, res) => {
  if (!gwEnabled()) return res.status(503).json({ error: "agent gateway disabled — set AGENT_GW_SECRET (>=32 chars) in /srv/apps/server-manager/.env and redeploy" });
  const { target, root_path, scopes, ttl, label } = req.body || {};
  try { parseTarget(target); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const minted = mintAgentToken({ target, rootPath: root_path, scopes, ttlSeconds: ttl, label: label || req.tokenEntry?.label });
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const baseUrl = `${proto}://${host}/api/agent-gw/t/${encodeURIComponent(target)}`;
    try { auditLog(req.tokenEntry?.label || "manager", "agent_grant", target, { jti: minted.jti, scopes: minted.payload.s, expires_at: minted.expires_at }); } catch { /* */ }
    res.json({
      sandbox_id: `infra:${target}`,
      base_url: baseUrl,
      access_token: minted.access_token,
      root_path: minted.payload.r,
      target,
      scopes: minted.payload.s,
      jti: minted.jti,
      expires_at: minted.expires_at,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/agent-gw/t/:target/exec — run a command on the target (scoped token).
// Matches matrx-ai's exec_command contract: { command, timeout?, user?, cwd?,
// env?, stdin? } → { exit_code, stdout, stderr, cwd }.
app.post("/api/agent-gw/t/:target/exec", agentGwAuth, (req, res) => {
  const payload = req.gwPayload;
  if (!payload.s?.includes("exec.run")) return res.status(403).json({ error: "token lacks exec.run scope" });
  const command = String(req.body?.command || "");
  if (!command.trim()) return res.status(400).json({ error: "command is required" });
  const blocked = guardDestructiveImageOp(command);
  if (blocked) return res.status(403).json({ exit_code: 126, stdout: "", stderr: blocked.error, cwd: payload.r });
  const result = gwExecOnTarget(payload, {
    command, cwd: req.body?.cwd, user: req.body?.user, env: req.body?.env, stdin: req.body?.stdin, timeout: req.body?.timeout,
  });
  try { auditLog(payload.lbl || "agent", "agent_exec", payload.t, { jti: payload.jti, command: command.slice(0, 500), exit_code: result.exit_code }); } catch { /* */ }
  res.json(result);
});

// ── Gateway filesystem + search surface (matrx-ai consumer contract) ────────
// Lets an agent's structured file tools (not just the shell) operate on the
// target. Scope-gated: fs.read for read/list/stat/search, fs.write for write/
// mkdir/patch. Backed by agent_gateway_fs.js (host -> Node fs at /host-srv;
// container -> docker exec). All audited.
function gwScope(req, res, scope) {
  if (!req.gwPayload.s?.includes(scope)) { res.status(403).json({ error: `token lacks ${scope} scope` }); return false; }
  return true;
}
function gwFs(fn, scope, action) {
  return (req, res) => {
    if (!gwScope(req, res, scope)) return;
    try {
      const out = fn(req.gwPayload, { ...req.query, ...req.body });
      try { auditLog(req.gwPayload.lbl || "agent", action, req.gwPayload.t, { jti: req.gwPayload.jti, path: req.query?.path || req.body?.path || req.body?.cwd }); } catch { /* */ }
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  };
}

app.get("/api/agent-gw/t/:target/fs/list", agentGwAuth, gwFs(fsList, "fs.read", "agent_fs_list"));
app.get("/api/agent-gw/t/:target/fs/stat", agentGwAuth, gwFs(fsStat, "fs.read", "agent_fs_stat"));
app.put("/api/agent-gw/t/:target/fs/write", agentGwAuth, gwFs(fsWrite, "fs.write", "agent_fs_write"));
app.post("/api/agent-gw/t/:target/fs/mkdir", agentGwAuth, gwFs(fsMkdir, "fs.write", "agent_fs_mkdir"));
app.post("/api/agent-gw/t/:target/fs/patch", agentGwAuth, gwFs(fsPatch, "fs.write", "agent_fs_patch"));
app.post("/api/agent-gw/t/:target/search/content", agentGwAuth, gwFs(searchContent, "search", "agent_search_content"));
app.post("/api/agent-gw/t/:target/search/paths", agentGwAuth, gwFs(searchPaths, "search", "agent_search_paths"));

// fs/read returns raw text/plain (utf8 or base64 string), not JSON — the
// consumer reads response.text() and decodes client-side.
app.get("/api/agent-gw/t/:target/fs/read", agentGwAuth, (req, res) => {
  if (!gwScope(req, res, "fs.read")) return;
  try {
    const text = fsRead(req.gwPayload, { path: req.query.path, encoding: req.query.encoding === "base64" ? "base64" : "utf8" });
    try { auditLog(req.gwPayload.lbl || "agent", "agent_fs_read", req.gwPayload.t, { jti: req.gwPayload.jti, path: req.query.path }); } catch { /* */ }
    res.type("text/plain").send(text);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/agent-gw/revoke — revoke a minted token by jti. admin only.
app.post("/api/agent-gw/revoke", authMiddleware, requireSuperadmin, (req, res) => {
  const jti = String(req.body?.jti || "");
  if (!jti) return res.status(400).json({ error: "jti is required" });
  revokeJti(jti);
  try { auditLog(req.tokenEntry?.label || "manager", "agent_revoke", jti, {}); } catch { /* */ }
  res.json({ ok: true, jti });
});

// GET /api/agent-gw/status — whether the gateway is enabled. admin only.
app.get("/api/agent-gw/status", authMiddleware, requireSuperadmin, (_req, res) => {
  res.json({ enabled: gwEnabled() });
});

// GET /api/auth-config — unauthenticated: tells the login screen whether the
// AI Matrx OAuth button should show and where to point it.
app.get("/api/auth-config", (_req, res) => {
  res.json({
    oauth_enabled: oauthEnabled(),
    aidream_url: (process.env.MATRX_AIDREAM_URL || "https://server.app.matrxserver.com").replace(/\/$/, ""),
  });
});

// GET /api/me — who am I (after auth). Drives the UI's identity + superadmin
// gating (display only; the backend enforces requireSuperadmin).
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({
    authenticated: !!req.tokenRole,
    email: req.oauthUser?.email || req.tokenEntry?.label || null,
    role: req.tokenRole || null,
    is_superadmin: !!req.isSuperadmin,
    auth_kind: req.authKind || null,
    level: req.oauthUser?.level || null,
  });
});

// GET /api/audit — the activity log (every audited operator/agent action),
// newest first. admin only. ?limit= &actor= &action= filters.
app.get("/api/audit", authMiddleware, requireRole("admin"), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
  res.json({ entries: readAuditLog({ limit, actor: req.query.actor, action: req.query.action }) });
});

// System
app.get("/api/system", authMiddleware, async (_req, res) => {
  res.json(getSystemInfo());
});

// Tokens (admin only)
app.get("/api/tokens", authMiddleware, requireSuperadmin, async (_req, res) => {
  const store = loadTokens();
  // Return tokens without the hashes
  const safe = store.tokens.map(({ token_hash, ...rest }) => rest);
  res.json({ tokens: safe, count: safe.length });
});

app.post("/api/tokens", authMiddleware, requireSuperadmin, async (req, res) => {
  const { label, role } = req.body;
  if (!label) return res.status(400).json({ error: "label required" });
  if (!["admin", "deployer", "viewer"].includes(role)) return res.status(400).json({ error: "role must be admin, deployer, or viewer" });

  const rawToken = randomHex(32);
  const store = loadTokens();
  const entry = {
    id: `tok_${randomHex(6)}`,
    token_hash: hashToken(rawToken),
    label,
    role,
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
  store.tokens.push(entry);
  saveTokens(store);

  // Return the raw token ONCE — it's never stored or retrievable again
  res.status(201).json({
    id: entry.id,
    token: rawToken,
    label,
    role,
    created_at: entry.created_at,
    note: "Save this token now — it cannot be retrieved again.",
  });
});

app.delete("/api/tokens/:id", authMiddleware, requireSuperadmin, async (req, res) => {
  const store = loadTokens();
  const idx = store.tokens.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Token not found" });
  if (store.tokens.length === 1) return res.status(400).json({ error: "Cannot delete the last token" });
  const removed = store.tokens.splice(idx, 1)[0];
  saveTokens(store);
  res.json({ success: true, removed: { id: removed.id, label: removed.label } });
});

// ── Secrets / environment variables (distinct from access Tokens) ───────────
// One place to SEE and SET the environment values across the system: each app's
// .env plus the key infra .env files (Manager, hosted orchestrator). Values are
// masked by default; ?reveal=1 returns them (super-admin only, audited). Upsert
// only — no delete-key via UI — and infra changes need a restart to take effect.
function secretStores() {
  const cfg = loadDeployments();
  const apps = Object.entries(cfg.instances || {}).map(([n, info]) => ({
    id: `app:${n}`, label: info.display_name || n, kind: "app", path: `${HOST_SRV}/apps/${n}/.env`,
    note: "Recreate the app to apply.",
  }));
  const infra = [
    { id: "infra:manager", label: "Server Manager", kind: "infra", path: `${HOST_SRV}/apps/server-manager/.env`, note: "Restart the Manager to apply (Deploy server can do it)." },
    { id: "infra:orchestrator", label: "Sandbox Orchestrator (hosted)", kind: "infra", path: `${HOST_SRV}/apps/sandbox-orchestrator/.env`, note: "Restart the orchestrator to apply." },
  ];
  return [...infra, ...apps];
}
function findSecretStore(id) { return secretStores().find((s) => s.id === id); }
function parseEnvFile(path) {
  const out = [];
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trimEnd();
    if (!line || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out.push({ key: line.slice(0, i).trim(), value: line.slice(i + 1) });
  }
  return out;
}
function maskSecret(v) {
  const len = (v || "").length;
  if (len === 0) return "(empty)";
  return `${"•".repeat(Math.min(len, 12))} · ${len} chars`;
}
function upsertEnvKey(path, key, value) {
  let lines = existsSync(path) ? readFileSync(path, "utf-8").split("\n") : [];
  let found = false;
  lines = lines.map((l) => (l.startsWith(`${key}=`) ? (found = true, `${key}=${value}`) : l));
  if (!found) {
    if (lines.length && lines[lines.length - 1].trim() === "") lines.splice(lines.length - 1, 0, `${key}=${value}`);
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join("\n"));
  try { chmodSync(path, 0o600); } catch { /* */ }
  return found ? "updated" : "added";
}

app.get("/api/secrets", authMiddleware, requireSuperadmin, (_req, res) => {
  const stores = secretStores().map((s) => {
    const exists = existsSync(s.path);
    let key_count = 0;
    if (exists) { try { key_count = parseEnvFile(s.path).length; } catch { /* */ } }
    return { id: s.id, label: s.label, kind: s.kind, exists, key_count, note: s.note || null };
  });
  res.json({ stores });
});

app.get("/api/secrets/entries", authMiddleware, requireSuperadmin, (req, res) => {
  const s = findSecretStore(String(req.query.id || ""));
  if (!s) return res.status(404).json({ error: "Unknown secret store" });
  const reveal = req.query.reveal === "1";
  if (!existsSync(s.path)) return res.json({ id: s.id, label: s.label, kind: s.kind, note: s.note || null, exists: false, entries: [] });
  const entries = parseEnvFile(s.path).map(({ key, value }) => ({ key, value: reveal ? value : maskSecret(value), masked: !reveal, length: value.length }));
  try { auditLog(req.tokenEntry?.label || "admin", reveal ? "secrets_reveal" : "secrets_view", s.id, { keys: entries.length }); } catch { /* */ }
  res.json({ id: s.id, label: s.label, kind: s.kind, note: s.note || null, exists: true, entries });
});

app.put("/api/secrets/entries", authMiddleware, requireSuperadmin, (req, res) => {
  const s = findSecretStore(String(req.query.id || ""));
  if (!s) return res.status(404).json({ error: "Unknown secret store" });
  const key = String(req.body?.key || "");
  const value = req.body?.value;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return res.status(400).json({ error: "Invalid key (letters, digits, underscore; not starting with a digit)" });
  if (typeof value !== "string") return res.status(400).json({ error: "value must be a string" });
  try {
    const action = upsertEnvKey(s.path, key, value);
    try { auditLog(req.tokenEntry?.label || "admin", "secrets_set", s.id, { key, action }); } catch { /* */ }
    res.json({ ok: true, id: s.id, key, action, note: s.note || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/secrets/bulk — Developer View save: parse a .env-style blob and UPSERT
// every KEY=value line (no deletes — keys absent from the text are left as-is, a
// safety choice so a paste can't wipe critical infra keys). superadmin.
app.put("/api/secrets/bulk", authMiddleware, requireSuperadmin, (req, res) => {
  const s = findSecretStore(String(req.query.id || ""));
  if (!s) return res.status(404).json({ error: "Unknown secret store" });
  const text = String(req.body?.text ?? "");
  const applied = [];
  const skipped = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) { skipped.push(line.slice(0, 40)); continue; }
    let key = line.slice(0, i).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    let value = line.slice(i + 1);
    // strip matching surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { skipped.push(key); continue; }
    try { upsertEnvKey(s.path, key, value); applied.push(key); } catch { skipped.push(key); }
  }
  try { auditLog(req.tokenEntry?.label || "admin", "secrets_bulk_set", s.id, { applied: applied.length, skipped: skipped.length }); } catch { /* */ }
  res.json({ ok: true, id: s.id, applied, skipped, note: s.note || null });
});

// ── Supabase Persistence Endpoints ──────────────────────────────────────────

app.get("/api/supabase/status", authMiddleware, async (_req, res) => {
  res.json({
    configured: isSupabaseConfigured(),
    supabase_url: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/\/(.{8}).*@/, "//$1***@") : null,
  });
});

app.post("/api/supabase/sync", authMiddleware, requireRole("admin"), async (_req, res) => {
  try {
    const deployments = loadDeployments();
    const tokens = loadTokens();
    const builds = loadBuildHistory();
    const result = await fullSync(deployments, tokens, builds);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/supabase/restore", authMiddleware, requireRole("admin"), async (_req, res) => {
  try {
    const result = await fullRestore();
    if (!result.restored) {
      return res.status(400).json(result);
    }
    // Write restored data to local files
    if (result.instances) {
      const config = loadDeployments();
      config.instances = result.instances;
      writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
    }
    if (result.tokens) {
      writeFileSync(TOKENS_FILE, JSON.stringify(result.tokens, null, 2) + "\n", "utf-8");
    }
    if (result.builds) {
      const historyFile = BUILD_HISTORY_FILE;
      writeFileSync(historyFile, JSON.stringify(result.builds, null, 2) + "\n", "utf-8");
    }
    res.json({ ...result, local_files_updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MCP protocol endpoint (Model Context Protocol — this is a genuine MCP endpoint)
app.post("/mcp", authMiddleware, async (req, res) => {
  // Thread the caller's role into the MCP server so each tool can enforce the
  // same authorization the HTTP routes do (destructive tools are role-gated).
  const server = createServer({ role: req.tokenRole, isSuperadmin: req.isSuperadmin });
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => { transport.close(); server.close(); });
  } catch (error) {
    console.error("MCP protocol error:", error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

app.get("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
app.delete("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));

// ── Start ────────────────────────────────────────────────────────────────────
initTokenStore();

// Fail closed in production: this process holds the Docker socket and the host
// filesystem, so booting with auth disabled (no token scheme and no OAuth) would
// expose shell exec + container control to anyone who can reach the port. Allow
// it only outside production, where open-by-default is a deliberate dev convenience.
{
  const authConfigured = !!(
    process.env.MANAGER_TOKENS ||
    process.env.MANAGER_BEARER_TOKEN ||
    process.env.MCP_BEARER_TOKEN ||
    oauthEnabled()
  );
  if (!authConfigured && process.env.NODE_ENV === "production") {
    console.error(
      "FATAL: Manager started in production with no authentication configured. " +
      "Set MANAGER_TOKENS (or MANAGER_BEARER_TOKEN / OAuth) before starting. Refusing to boot.",
    );
    process.exit(1);
  }
}

// Surface unhandled rejections instead of letting Node silently swallow them —
// several paths use fire-and-forget promises and a crash-causing rejection here
// would otherwise be invisible.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const httpServer = http.createServer(app);
// Browser terminals: WebSocket upgrades on /api/terminal → PTY (see terminal_ws.js).
attachTerminalWs(httpServer, { verifyToken, auditLog, oauthEnabled, authenticateOAuthAdmin });
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Matrx Manager v2.0 listening on port ${PORT}`);
  console.log(`Dashboard: http://0.0.0.0:${PORT}/admin`);
  console.log(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
  console.log(`Terminal WS: ws://0.0.0.0:${PORT}/api/terminal`);
  const hasAuth = !!(process.env.MANAGER_TOKENS || process.env.MANAGER_BEARER_TOKEN || process.env.MCP_BEARER_TOKEN);
  console.log(`Auth: ${hasAuth ? "enabled (token store)" : "DISABLED"}`);
  console.log(`Supabase: ${isSupabaseConfigured() ? "configured" : "not configured (local-only mode)"}`);

  // Background sync to Supabase on startup
  if (isSupabaseConfigured()) {
    (async () => {
      try {
        const deployments = loadDeployments();
        const tokens = loadTokens();
        const builds = loadBuildHistory();
        const result = await fullSync(deployments, tokens, builds);
        console.log(`Supabase startup sync: ${result.synced ? "complete" : result.reason}`);
      } catch (err) {
        console.error("Supabase startup sync failed:", err.message);
      }
    })();
  }
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
