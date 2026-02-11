import { NextRequest, NextResponse } from "next/server";
import { verifyToken, getBuildHistory } from "@/lib/docker";

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !verifyToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const include_failed = url.searchParams.get("include_failed") === "true";
  return NextResponse.json(getBuildHistory({ limit, include_failed }));
}
