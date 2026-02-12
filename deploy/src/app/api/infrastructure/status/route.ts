import { NextResponse } from "next/server";
import { execSync } from "node:child_process";

function exec(cmd: string) {
  try {
    return { success: true, output: execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim() };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return { success: false, output: e.stdout?.trim() || "", error: e.stderr?.trim() || e.message };
  }
}

function getContainerStatus(name: string) {
  const inspect = exec(`docker inspect ${name} --format '{{.State.Status}} {{.State.Health.Status}}' 2>/dev/null`);
  if (!inspect.success) return { name, status: "not found", health: null };
  const parts = (inspect.output || "").split(" ");
  return { name, status: parts[0] || "unknown", health: parts[1] || null };
}

export async function GET() {
  // Traefik
  const traefik = getContainerStatus("traefik");
  const traefikRoutes = exec(
    `docker ps --format '{{.Names}}' | xargs -I{} docker inspect {} --format '{{.Name}} {{range $k,$v := .Config.Labels}}{{if eq (index (split $k ".") 0) "traefik"}}{{$k}}={{$v}} {{end}}{{end}}' 2>/dev/null`,
  );

  // PostgreSQL
  const postgres = getContainerStatus("postgres");
  const pgadmin = getContainerStatus("pgadmin");
  const pgSize = exec(`docker exec postgres psql -U matrx -d matrx -tc "SELECT pg_size_pretty(pg_database_size('matrx'))" 2>/dev/null`);
  const pgConnections = exec(`docker exec postgres psql -U matrx -d matrx -tc "SELECT count(*) FROM pg_stat_activity" 2>/dev/null`);

  // Agents
  const agent1 = getContainerStatus("agent-1");
  const agent2 = getContainerStatus("agent-2");

  // Docker system
  const dockerInfo = exec("docker info --format '{{.ContainersRunning}} running, {{.ContainersPaused}} paused, {{.ContainersStopped}} stopped, {{.Images}} images'");
  const diskUsage = exec("docker system df --format '{{.Type}}\t{{.Size}}\t{{.Reclaimable}}'");

  return NextResponse.json({
    traefik: {
      ...traefik,
      routes_raw: traefikRoutes.output || "",
    },
    postgres: {
      ...postgres,
      size: pgSize.output?.trim() || "unknown",
      connections: pgConnections.output?.trim() || "unknown",
    },
    pgadmin,
    agents: [agent1, agent2],
    docker: {
      summary: dockerInfo.output || "unknown",
      disk_usage: diskUsage.output || "unknown",
    },
  });
}
