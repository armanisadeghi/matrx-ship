import { NextRequest, NextResponse } from "next/server";
import { verifyToken, getInstances } from "@/lib/docker";

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ instances: getInstances() });
}
