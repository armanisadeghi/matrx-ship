import { NextRequest, NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { requireAuth } from "@/lib/docker";

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

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  // Traefik
  const traefik = getContainerStatus("traefik");
  const traefikRoutes = exec(
    `docker ps --format '{{.Names}}' | xargs -I{} docker inspect {} --format '{{.Name}} {{range $k,$v := .Config.Labels}}{{if eq (index (split $k ".") 0) "traefik"}}{{$k}}={{$v}} {{end}}{{end}}' 2>/dev/null`,
  );


  // Docker system
  const dockerInfo = exec("docker info --format '{{.ContainersRunning}} running, {{.ContainersPaused}} paused, {{.ContainersStopped}} stopped, {{.Images}} images'");
  const diskUsage = exec("docker system df --format '{{.Type}}\t{{.Size}}\t{{.Reclaimable}}'");

  return NextResponse.json({
    traefik: {
      ...traefik,
      routes_raw: traefikRoutes.output || "",
    },
    docker: {
      summary: dockerInfo.output || "unknown",
      disk_usage: diskUsage.output || "unknown",
    },
  });
}
