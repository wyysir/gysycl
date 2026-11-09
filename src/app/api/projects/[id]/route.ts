import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { updateProject } from "@/server/master-maintenance";
export const runtime = "nodejs";
const schema = z.object({ updatedAt: z.string().datetime(), name: z.string().trim().min(2).max(80), region: z.string().trim().max(50), active: z.boolean() });
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await updateProject(await requireUser(request), (await context.params).id, await parseJson(request, schema))); }
  catch (error) { return handleApiError(error); }
}
