import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { requireAuth } from "@/lib/docker";

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  // Bound the tail to an integer and validate `since` — both were previously
  // interpolated unsanitized into an execSync string, so `?since=$(...)` ran as
  // a shell command. argv form means no shell parsing of these values at all.
  const tail = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("tail") || "200", 10) || 200, 1), 100000);
  const since = req.nextUrl.searchParams.get("since");
  if (since != null && !/^[A-Za-z0-9:.+_-]+$/.test(since)) {
    return NextResponse.json({ error: "invalid 'since' value" }, { status: 400 });
  }

  const args = ["logs", "matrx-manager", "--tail", String(tail)];
  if (since) args.push("--since", since);

  try {
    const output = execFileSync("docker", args, { encoding: "utf-8", timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
    return NextResponse.json({ output });
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return NextResponse.json({ output: e.stdout || "", error: e.stderr || e.message }, { status: 500 });
  }
}
