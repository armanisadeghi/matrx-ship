import { NextResponse } from "next/server";
import { execSync } from "node:child_process";

function exec(cmd: string, opts: { timeout?: number; cwd?: string } = {}) {
  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout: opts.timeout || 15000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: opts.cwd,
    });
    return { success: true, output: result.trim() };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; message: string; status?: number };
    return { success: false, output: e.stdout?.trim() || "", error: e.stderr?.trim() || e.message };
  }
}

export async function GET() {
  const containerName = "matrx-manager";

  // Container inspection
  const inspect = exec(`docker inspect ${containerName} --format '{{json .}}'`);
  let containerInfo = null;
  if (inspect.success) {
    try {
      const raw = JSON.parse(inspect.output);
      containerInfo = {
        status: raw.State?.Status,
        running: raw.State?.Running,
        started_at: raw.State?.StartedAt,
        created: raw.Created,
        image: raw.Config?.Image,
        restart_count: raw.RestartCount,
        health: raw.State?.Health?.Status || null,
        ports: raw.NetworkSettings?.Ports,
        networks: Object.keys(raw.NetworkSettings?.Networks || {}),
      };
    } catch { /* parsing error */ }
  }

  // Container stats
  const stats = exec(`docker stats ${containerName} --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","mem_pct":"{{.MemPerc}}","net":"{{.NetIO}}","block":"{{.BlockIO}}","pids":"{{.PIDs}}"}'`);
  let statsData = null;
  try { if (stats.success) statsData = JSON.parse(stats.output); } catch { /* ok */ }

  // Health check
  let healthCheck = null;
  try {
    const hc = exec(`docker exec ${containerName} wget -qO- http://127.0.0.1:3000/health 2>/dev/null`);
    if (hc.success) healthCheck = JSON.parse(hc.output);
  } catch { /* ok */ }

  // Git info for the server-manager source
  const hostSrv = "/host-srv";
  const srcDir = `${hostSrv}/projects/matrx-ship/server-manager`;
  const gitCommit = exec(`git -C ${srcDir} rev-parse --short HEAD 2>/dev/null`);
  const gitBranch = exec(`git -C ${srcDir} rev-parse --abbrev-ref HEAD 2>/dev/null`);

  return NextResponse.json({
    container_name: containerName,
    container: containerInfo,
    stats: statsData,
    health_check: healthCheck,
    source: {
      path: "/srv/projects/matrx-ship/server-manager",
      git_commit: gitCommit.output || "unknown",
      git_branch: gitBranch.output || "unknown",
    },
    url: "https://manager.dev.codematrx.com",
    admin_url: "https://manager.dev.codematrx.com/admin",
    mcp_url: "https://manager.dev.codematrx.com/mcp",
  });
}
