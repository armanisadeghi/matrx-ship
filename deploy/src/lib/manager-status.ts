import { NextRequest, NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { verifyToken } from "@/lib/docker";
import { classifyManagerHealth } from "@/lib/manager-health";

export type CommandRunner = (cmd: string, opts?: { timeout?: number; cwd?: string }) => { success: boolean; output: string; error?: string };

const exec: CommandRunner = (cmd, opts = {}) => {
  try {
    const result = execSync(cmd, { encoding: "utf-8", timeout: opts.timeout || 15000, maxBuffer: 10 * 1024 * 1024, cwd: opts.cwd });
    return { success: true, output: result.trim() };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return { success: false, output: e.stdout?.trim() || "", error: e.stderr?.trim() || e.message };
  }
};

export function managerStatusPayload(run: CommandRunner = exec) {
  const containerName = "matrx-manager";
  const inspect = run(`docker inspect ${containerName} --format '{{json .}}'`);
  let containerInfo = null;
  if (inspect.success) {
    try {
      const raw = JSON.parse(inspect.output);
      containerInfo = { status: raw.State?.Status, running: raw.State?.Running, started_at: raw.State?.StartedAt, created: raw.Created, image: raw.Config?.Image, restart_count: raw.RestartCount, health: raw.State?.Health?.Status || null, ports: raw.NetworkSettings?.Ports, networks: Object.keys(raw.NetworkSettings?.Networks || {}) };
    } catch { /* malformed inspect is unknown */ }
  }
  const stats = run(`docker stats ${containerName} --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","mem_pct":"{{.MemPerc}}","net":"{{.NetIO}}","block":"{{.BlockIO}}","pids":"{{.PIDs}}"}'`);
  let statsData = null;
  try { if (stats.success) statsData = JSON.parse(stats.output); } catch { /* optional stats */ }
  const probe = run(`docker exec ${containerName} node -e 'fetch("http://127.0.0.1:3000/health",{signal:AbortSignal.timeout(3000)}).then(async r => process.stdout.write(JSON.stringify({status:r.status,body:(await r.text()).slice(0,4096)}))).catch(e => { console.error(e.message); process.exit(1) })'`, { timeout: 5000 });
  const managerHealth = classifyManagerHealth(containerInfo ? { running: containerInfo.running } : null, probe);
  let healthCheck: unknown = null;
  if (probe.success) { try { healthCheck = JSON.parse(probe.output); } catch { /* classifier reports unknown */ } }
  const srcDir = "/host-srv/projects/matrx-ship/server-manager";
  const gitCommit = run(`git -C ${srcDir} rev-parse --short HEAD 2>/dev/null`);
  const gitBranch = run(`git -C ${srcDir} rev-parse --abbrev-ref HEAD 2>/dev/null`);
  return { container_name: containerName, container: containerInfo, stats: statsData, health_check: healthCheck, health_status: managerHealth.status, health_response_status: managerHealth.response_status, source: { path: "/srv/projects/matrx-ship/server-manager", git_commit: gitCommit.output || "unknown", git_branch: gitBranch.output || "unknown" }, url: "https://manager.dev.codematrx.com", admin_url: "https://manager.dev.codematrx.com/admin", mcp_url: "https://manager.dev.codematrx.com/mcp" };
}

export function managerStatusResponse(req: NextRequest, run: CommandRunner = exec) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(managerStatusPayload(run));
}
