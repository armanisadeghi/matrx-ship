import { NextRequest, NextResponse } from "next/server";
import { verifyToken, rebuildInstances } from "@/lib/docker";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = rebuildInstances({ name: body.name, skip_build: body.skip_build, triggered_by: "deploy-ui" });
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
