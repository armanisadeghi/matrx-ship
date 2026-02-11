import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", service: "matrx-deploy", timestamp: new Date().toISOString() });
}
