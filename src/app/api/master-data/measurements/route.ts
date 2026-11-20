import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { handleApiError } from "@/server/http";
import { listMeasurements } from "@/server/measurements";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await listMeasurements(await requireUser(request))); }
  catch (error) { return handleApiError(error); }
}
