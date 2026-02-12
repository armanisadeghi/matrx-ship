import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { cpus, totalmem, freemem, uptime as osUptime, hostname } from "node:os";

// Host paths — the deploy container mounts /srv and Docker socket
const HOST_SRV = process.env.HOST_SRV_PATH || "/host-srv";
const APPS_DIR = join(HOST_SRV, "apps");
const DEPLOYMENTS_FILE = join(APPS_DIR, "deployments.json");
const BUILD_HISTORY_FILE = join(APPS_DIR, "build-history.json");
const TOKENS_FILE = join(APPS_DIR, "tokens.json");

function exec(cmd: string, opts: { timeout?: number; cwd?: string } = {}) {
  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout: opts.timeout || 30000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: opts.cwd,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return { success: true, output: result.trim() };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; message: string; status?: number };
    return {
      success: false,
      output: e.stdout?.trim() || "",
      error: e.stderr?.trim() || e.message,
      exitCode: e.status,
    };
  }
}

function randomHex(bytes: number) {
  return randomBytes(bytes).toString("hex");
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

// ── Token Verification ──────────────────────────────────────────────────────

interface TokenEntry {
  id: string;
  token_hash: string;
  label: string;
  role: string;
  created_at: string;
  last_used_at: string | null;
}

function loadTokens(): { tokens: TokenEntry[] } {
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, "utf-8"));
  } catch {
    return { tokens: [] };
  }
}

export function verifyToken(bearerToken: string): TokenEntry | null {
  if (!bearerToken) return null;
  const { createHash } = require("node:crypto");
  const hash = createHash("sha256").update(bearerToken).digest("hex");
  const store = loadTokens();
  const entry = store.tokens.find((t) => t.token_hash === hash);
  if (!entry) return null;
  return entry;
}

// ── Deployments ─────────────────────────────────────────────────────────────

interface DeploymentConfig {
  defaults: { image: string; source: string; domain_suffix: string; postgres_image: string };
  instances: Record<string, {
    display_name: string;
    subdomain: string;
    url: string;
    api_key: string;
    db_password: string;
    postgres_image: string;
    created_at: string;
    status: string;
  }>;
}

function loadDeployments(): DeploymentConfig {
  try {
    return JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf-8"));
  } catch {
    return { defaults: { image: "matrx-ship:latest", source: "/srv/projects/matrx-ship", domain_suffix: "dev.codematrx.com", postgres_image: "postgres:17-alpine" }, instances: {} };
  }
}

// ── Build History ───────────────────────────────────────────────────────────

interface BuildRecord {
  id: string;
  tag: string;
  timestamp: string;
  git_commit: string;
  git_message: string;
  image_id: string | null;
  success: boolean;
  error: string | null;
  duration_ms: number;
  triggered_by: string;
  instances_restarted: string[];
}

function loadBuildHistory(): { builds: BuildRecord[] } {
  try {
    return JSON.parse(readFileSync(BUILD_HISTORY_FILE, "utf-8"));
  } catch {
    return { builds: [] };
  }
}

function saveBuildHistory(history: { builds: BuildRecord[] }) {
  mkdirSync(dirname(BUILD_HISTORY_FILE), { recursive: true });
  writeFileSync(BUILD_HISTORY_FILE, JSON.stringify(history, null, 2) + "\n", "utf-8");
}

function recordBuild(entry: BuildRecord) {
  const history = loadBuildHistory();
  history.builds.unshift(entry);
  saveBuildHistory(history);
}

function generateBuildTag() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ── Exported Functions ──────────────────────────────────────────────────────

export function getBuildInfo() {
  const config = loadDeployments();
  const src = join(HOST_SRV, "projects/matrx-ship");

  const imgInspect = exec("docker inspect matrx-ship:latest --format '{{.Id}} {{.Created}}' 2>/dev/null");
  let currentImage = { id: null as string | null, created: null as string | null, age: null as string | null };
  if (imgInspect.success && imgInspect.output) {
    const parts = imgInspect.output.split(" ");
    const id = parts[0]?.replace("sha256:", "").substring(0, 12);
    const created = parts.slice(1).join(" ");
    const ageMs = created ? Date.now() - new Date(created).getTime() : 0;
    const ageHours = Math.floor(ageMs / 3600000);
    currentImage = { id, created, age: ageHours < 24 ? `${ageHours}h` : `${Math.floor(ageHours / 24)}d ${ageHours % 24}h` };
  }

  const gitCommit = exec(`git -C ${src} rev-parse --short HEAD`);
  const gitBranch = exec(`git -C ${src} rev-parse --abbrev-ref HEAD`);
  const history = loadBuildHistory();
  const lastSuccessful = history.builds.find((b) => b.success);
  const lastBuildCommit = lastSuccessful?.git_commit || null;

  let pendingCommits: string[] = [];
  let diffStats: string | null = null;
  if (lastBuildCommit && gitCommit.output && lastBuildCommit !== gitCommit.output) {
    const logResult = exec(`git -C ${src} log --oneline ${lastBuildCommit}..HEAD 2>/dev/null`);
    if (logResult.success && logResult.output) pendingCommits = logResult.output.split("\n").filter(Boolean);
    const statResult = exec(`git -C ${src} diff --stat ${lastBuildCommit}..HEAD 2>/dev/null`);
    if (statResult.success) diffStats = statResult.output;
  } else if (!lastBuildCommit) {
    const logResult = exec(`git -C ${src} log --oneline -10 2>/dev/null`);
    if (logResult.success && logResult.output) pendingCommits = logResult.output.split("\n").filter(Boolean);
  }

  const instances = Object.entries(config.instances).map(([n, info]) => {
    const status = exec(`docker inspect ${n} --format '{{.State.Status}}' 2>/dev/null`);
    return { name: n, display_name: info.display_name, status: status.output || "not found" };
  });

  const tagsResult = exec("docker images matrx-ship --format '{{.Tag}} {{.ID}} {{.CreatedSince}}' 2>/dev/null");
  const availableTags: Array<{ tag: string; id: string; age: string }> = [];
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
      path: "/srv/projects/matrx-ship",
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

export function getBuildHistory(opts: { limit?: number; include_failed?: boolean } = {}) {
  const history = loadBuildHistory();
  let builds = history.builds;
  if (!opts.include_failed) builds = builds.filter((b) => b.success);
  if (opts.limit) builds = builds.slice(0, opts.limit);
  return { builds, total: history.builds.length };
}

export function rebuildInstances(opts: { name?: string; skip_build?: boolean; triggered_by?: string } = {}) {
  const config = loadDeployments();
  const results: Record<string, unknown> = {};
  const started_at = new Date().toISOString();
  const buildTag = generateBuildTag();
  const src = join(HOST_SRV, "projects/matrx-ship");

  const gitCommit = exec(`git -C ${src} rev-parse --short HEAD`);
  const gitLog = exec(`git -C ${src} log -1 --pretty=format:"%s"`);

  let imageId: string | null = null;
  if (!opts.skip_build) {
    exec("docker tag matrx-ship:latest matrx-ship:rollback 2>/dev/null");
    const buildResult = exec(`docker buildx build --load -t matrx-ship:latest -t matrx-ship:${buildTag} ${src}`, { timeout: 600000 });
    results.build = buildResult;
    if (!buildResult.success) {
      recordBuild({
        id: `bld_${randomHex(6)}`,
        tag: buildTag,
        timestamp: started_at,
        git_commit: gitCommit.output || "unknown",
        git_message: gitLog.output || "unknown",
        image_id: null,
        success: false,
        error: buildResult.error || "Build failed",
        duration_ms: Date.now() - new Date(started_at).getTime(),
        triggered_by: opts.triggered_by || "deploy-app",
        instances_restarted: [],
      });
      return { success: false, step: "build", error: buildResult.error, started_at, finished_at: new Date().toISOString() };
    }
    const imgInspect = exec("docker inspect matrx-ship:latest --format '{{.Id}}'");
    imageId = imgInspect.output?.replace("sha256:", "").substring(0, 12) || null;
  }

  const targets = opts.name ? [opts.name] : Object.keys(config.instances);
  const restarts: Record<string, unknown> = {};
  for (const t of targets) {
    if (!config.instances[t]) { restarts[t] = { error: "not found" }; continue; }
    restarts[t] = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });
  }
  results.restarts = restarts;

  const finished_at = new Date().toISOString();

  if (!opts.skip_build) {
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
      triggered_by: opts.triggered_by || "deploy-app",
      instances_restarted: targets,
    });
  }

  return { success: true, image_rebuilt: !opts.skip_build, build_tag: opts.skip_build ? null : buildTag, image_id: imageId, instances_restarted: targets, started_at, finished_at, results };
}

export function rollbackBuild(tag: string) {
  if (!tag) return { success: false, error: "tag is required" };
  const check = exec(`docker inspect matrx-ship:${tag} --format '{{.Id}}' 2>/dev/null`);
  if (!check.success) return { success: false, error: `Image tag matrx-ship:${tag} not found` };

  exec("docker tag matrx-ship:latest matrx-ship:pre-rollback 2>/dev/null");
  const retag = exec(`docker tag matrx-ship:${tag} matrx-ship:latest`);
  if (!retag.success) return { success: false, error: `Failed to retag: ${retag.error}` };

  const config = loadDeployments();
  const targets = Object.keys(config.instances);
  const restarts: Record<string, unknown> = {};
  for (const t of targets) {
    restarts[t] = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });
  }

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

  return { success: true, rolled_back_to: tag, image_id: check.output?.replace("sha256:", "").substring(0, 12) || null, instances_restarted: targets, restarts };
}

export function rebuildServerManager() {
  const mcpDir = join(HOST_SRV, "mcp-servers");
  if (!existsSync(join(mcpDir, "docker-compose.yml"))) {
    return { success: false, error: "docker-compose.yml not found in /srv/mcp-servers/" };
  }
  const result = exec("docker compose up -d --build server-manager", { cwd: mcpDir, timeout: 300000 });
  return { success: result.success, output: result.output || result.error };
}

export function rebuildDeployApp() {
  const deployDir = join(HOST_SRV, "apps/deploy");
  if (!existsSync(join(deployDir, "docker-compose.yml"))) {
    return { success: false, error: "docker-compose.yml not found in /srv/apps/deploy/" };
  }
  const result = exec("docker compose up -d --build", { cwd: deployDir, timeout: 300000 });
  return { success: result.success, output: result.output || result.error };
}

export function getSystemInfo() {
  const disk = exec("df -h / | tail -1 | awk '{print $2, $3, $4, $5}'");
  const diskParts = disk.output?.split(" ") || [];
  const dockerInfo = exec("docker info --format '{{.ContainersRunning}} running, {{.ContainersPaused}} paused, {{.ContainersStopped}} stopped, {{.Images}} images'");
  const containers = exec("docker ps --format '{{.Names}} {{.Status}} {{.Image}}' 2>/dev/null");
  return {
    hostname: hostname(),
    cpus: cpus().length,
    memory: { total: formatBytes(totalmem()), free: formatBytes(freemem()), used: formatBytes(totalmem() - freemem()), percent: ((1 - freemem() / totalmem()) * 100).toFixed(1) + "%" },
    disk: { total: diskParts[0] || "?", used: diskParts[1] || "?", available: diskParts[2] || "?", percent: diskParts[3] || "?" },
    uptime_hours: (osUptime() / 3600).toFixed(1),
    docker: dockerInfo.output,
    containers: containers.output?.split("\n").filter(Boolean) || [],
  };
}

export function getInstances() {
  const config = loadDeployments();
  return Object.entries(config.instances).map(([name, info]) => {
    const status = exec(`docker inspect ${name} --format '{{.State.Status}}' 2>/dev/null`);
    return { name, display_name: info.display_name, url: info.url, status: status.output || "not found" };
  });
}

// ── Streaming Rebuild (for SSE endpoints) ──────────────────────────────────

export function streamingRebuild(
  opts: { name?: string; skip_build?: boolean; triggered_by?: string },
  send: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const config = loadDeployments();
    const src = join(HOST_SRV, "projects/matrx-ship");
    const buildTag = generateBuildTag();
    const started_at = new Date().toISOString();

    const gitCommit = exec(`git -C ${src} rev-parse --short HEAD`);
    const gitLog = exec(`git -C ${src} log -1 --pretty=format:"%s"`);

    send("log", { message: `Build started at ${started_at}` });
    send("log", { message: `Source: ${src}` });
    send("log", { message: `Git: ${gitCommit.output || "?"} — ${gitLog.output || "?"}` });
    send("log", { message: `Build tag: ${buildTag}` });

    if (!opts.skip_build) {
      exec("docker tag matrx-ship:latest matrx-ship:rollback 2>/dev/null");
      send("log", { message: "Tagged current :latest as :rollback" });
      send("phase", { phase: "build", message: "Building Docker image..." });

      const proc = spawn("docker", ["buildx", "build", "--load", "--progress=plain", "-t", "matrx-ship:latest", "-t", `matrx-ship:${buildTag}`, src], {
        env: { ...process.env, PATH: process.env.PATH, DOCKER_BUILDKIT: "1" },
      });

      proc.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          send("log", { message: line });
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          send("log", { message: line });
        }
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          const duration_ms = Date.now() - new Date(started_at).getTime();
          recordBuild({
            id: `bld_${randomHex(6)}`, tag: buildTag, timestamp: started_at,
            git_commit: gitCommit.output || "unknown", git_message: gitLog.output || "unknown",
            image_id: null, success: false, error: `Build exited with code ${code}`,
            duration_ms, triggered_by: opts.triggered_by || "deploy-app", instances_restarted: [],
          });
          send("error", { success: false, error: `Build failed with exit code ${code}`, duration_ms });
          resolve();
          return;
        }

        send("phase", { phase: "build-done", message: "Docker image built successfully" });
        const imgInspect = exec("docker inspect matrx-ship:latest --format '{{.Id}}'");
        const imageId = imgInspect.output?.replace("sha256:", "").substring(0, 12) || null;
        send("log", { message: `Image ID: ${imageId}` });

        const targets = opts.name ? [opts.name] : Object.keys(config.instances);
        send("phase", { phase: "restart", message: `Restarting ${targets.length} instance(s)...` });

        for (const t of targets) {
          if (!config.instances[t]) continue;
          send("log", { message: `Restarting ${t}...` });
          const r = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });
          send("log", { message: `${t}: ${r.success ? "restarted" : r.error}` });
        }

        const finished_at = new Date().toISOString();
        const duration_ms = Date.now() - new Date(started_at).getTime();

        recordBuild({
          id: `bld_${randomHex(6)}`, tag: buildTag, timestamp: started_at,
          git_commit: gitCommit.output || "unknown", git_message: gitLog.output || "unknown",
          image_id: imageId, success: true, error: null, duration_ms,
          triggered_by: opts.triggered_by || "deploy-app", instances_restarted: targets,
        });

        try { cleanupBuilds(); } catch { /* non-fatal */ }
        send("done", { success: true, build_tag: buildTag, image_id: imageId, instances_restarted: targets, duration_ms, started_at, finished_at });
        resolve();
      });

      proc.on("error", (err: Error) => {
        send("error", { success: false, error: err.message });
        resolve();
      });
    } else {
      const targets = opts.name ? [opts.name] : Object.keys(config.instances);
      send("phase", { phase: "restart", message: `Restarting ${targets.length} instance(s) (no rebuild)...` });
      for (const t of targets) {
        if (!config.instances[t]) continue;
        send("log", { message: `Restarting ${t}...` });
        const r = exec("docker compose up -d --force-recreate app", { cwd: join(APPS_DIR, t), timeout: 60000 });
        send("log", { message: `${t}: ${r.success ? "restarted" : r.error}` });
      }
      send("done", { success: true, instances_restarted: targets, image_rebuilt: false });
      resolve();
    }
  });
}

export function streamingSelfRebuild(
  send: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const mcpDir = join(HOST_SRV, "mcp-servers");

    send("phase", { phase: "build", message: "Rebuilding server manager..." });
    send("log", { message: "Running: docker compose up -d --build server-manager" });
    send("log", { message: `Working directory: ${mcpDir}` });

    const proc = spawn("docker", ["compose", "up", "-d", "--build", "server-manager"], {
      cwd: mcpDir,
      env: { ...process.env, PATH: process.env.PATH },
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        send("log", { message: line });
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        send("log", { message: line });
      }
    });

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        send("done", { success: true, message: "Server manager rebuilt. Container will restart — connection may drop momentarily." });
      } else {
        send("error", { success: false, error: `docker compose exited with code ${code}` });
      }
      resolve();
    });

    proc.on("error", (err: Error) => {
      send("error", { success: false, error: err.message });
      resolve();
    });
  });
}

export function cleanupBuilds() {
  const history = loadBuildHistory();
  const successfulBuilds = history.builds.filter((b) => b.success && b.tag && !b.tag.startsWith("rollback"));
  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;
  const tagsToKeep = new Set(["latest", "rollback", "pre-rollback"]);

  for (const b of successfulBuilds.slice(0, 3)) tagsToKeep.add(b.tag);
  for (let w = 0; w < 4; w++) {
    const weekBuild = successfulBuilds.find((b) => {
      const t = new Date(b.timestamp).getTime();
      return t >= now - (w + 1) * ONE_WEEK && t < now - w * ONE_WEEK;
    });
    if (weekBuild) tagsToKeep.add(weekBuild.tag);
  }
  for (let m = 0; m < 3; m++) {
    const monthBuild = successfulBuilds.find((b) => {
      const t = new Date(b.timestamp).getTime();
      return t >= now - (m + 1) * ONE_MONTH && t < now - m * ONE_MONTH;
    });
    if (monthBuild) tagsToKeep.add(monthBuild.tag);
  }

  const allTagsResult = exec("docker images matrx-ship --format '{{.Tag}}' 2>/dev/null");
  const allTags = allTagsResult.success ? allTagsResult.output.split("\n").filter(Boolean) : [];
  const removed: string[] = [];
  for (const tag of allTags) {
    if (tag === "<none>" || tagsToKeep.has(tag)) continue;
    const rm = exec(`docker rmi matrx-ship:${tag} 2>/dev/null`);
    if (rm.success) removed.push(tag);
  }
  return { kept: [...tagsToKeep].filter((t) => allTags.includes(t)), removed, total_before: allTags.length, total_after: allTags.length - removed.length };
}
