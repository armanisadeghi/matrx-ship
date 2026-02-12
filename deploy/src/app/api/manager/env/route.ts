import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ENV_PATH = "/host-srv/apps/server-manager/.env";

export async function GET() {
  try {
    const content = readFileSync(ENV_PATH, "utf-8");
    const vars = content
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => {
        const eq = l.indexOf("=");
        if (eq === -1) return null;
        const key = l.substring(0, eq).trim();
        const value = l.substring(eq + 1).trim();
        const sensitive = /PASSWORD|SECRET|TOKEN|KEY/.test(key);
        return { key, value: sensitive ? "****" : value, sensitive };
      })
      .filter(Boolean);
    return NextResponse.json({ vars });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { env_vars, restart } = await req.json() as { env_vars: Record<string, string>; restart?: boolean };
    if (!env_vars || typeof env_vars !== "object") {
      return NextResponse.json({ error: "env_vars object required" }, { status: 400 });
    }

    let content = readFileSync(ENV_PATH, "utf-8");
    for (const [k, v] of Object.entries(env_vars)) {
      const re = new RegExp(`^${k}=.*$`, "m");
      content = re.test(content) ? content.replace(re, `${k}=${v}`) : content + `\n${k}=${v}`;
    }
    writeFileSync(ENV_PATH, content, "utf-8");

    if (restart !== false) {
      try {
        execSync("docker compose restart server-manager", {
          cwd: "/host-srv/apps/server-manager",
          timeout: 60000,
          encoding: "utf-8",
        });
      } catch { /* restart may briefly fail */ }
    }

    return NextResponse.json({
      success: true,
      updated: Object.keys(env_vars),
      restarted: restart !== false,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
