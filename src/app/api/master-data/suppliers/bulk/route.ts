import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { bulkMaintain, bulkSchema } from "@/server/bulk-maintenance";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { return NextResponse.json(await bulkMaintain(await requireUser(request), "supplier", await parseJson(request, bulkSchema))); }
  catch (error) { return handleApiError(error); }
}
