import { NextRequest } from "next/server";
import { managerStatusResponse } from "@/lib/manager-status";

export async function GET(req: NextRequest) {
  return managerStatusResponse(req);
}
