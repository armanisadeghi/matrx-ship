import { NextRequest, NextResponse } from "next/server";
import { verifyToken, rollbackBuild } from "@/lib/docker";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.tag) return NextResponse.json({ error: "tag is required" }, { status: 400 });
  const result = rollbackBuild(body.tag);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
