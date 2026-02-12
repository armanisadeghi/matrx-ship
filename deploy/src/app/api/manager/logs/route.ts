import { NextRequest, NextResponse } from "next/server";
import { execSync } from "node:child_process";

export async function GET(req: NextRequest) {
  const tail = req.nextUrl.searchParams.get("tail") || "200";
  const since = req.nextUrl.searchParams.get("since");

  let cmd = `docker logs matrx-manager --tail ${tail}`;
  if (since) cmd += ` --since ${since}`;
  cmd += " 2>&1";

  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
    return NextResponse.json({ output });
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return NextResponse.json({ output: e.stdout || "", error: e.stderr || e.message }, { status: 500 });
  }
}
