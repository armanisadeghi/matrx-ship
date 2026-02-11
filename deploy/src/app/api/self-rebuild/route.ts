import { NextRequest, NextResponse } from "next/server";
import { verifyToken, rebuildServerManager } from "@/lib/docker";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = rebuildServerManager();
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
