import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { configureMeasurement, measurementSchema } from "@/server/measurements";
export const runtime = "nodejs";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await configureMeasurement(await requireUser(request), (await context.params).id, await parseJson(request, measurementSchema))); }
  catch (error) { return handleApiError(error); }
}
