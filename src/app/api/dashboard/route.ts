import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { getDashboard } from "@/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await getDashboard(user));
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
