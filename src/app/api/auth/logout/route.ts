import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookies, requireOrigin } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  requireOrigin(request);
  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
