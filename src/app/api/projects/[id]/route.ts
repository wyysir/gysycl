import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { updateProject } from "@/server/master-maintenance";
import { deleteProject } from "@/server/project-deletion";
export const runtime = "nodejs";
const schema = z.object({ updatedAt: z.string().datetime(), name: z.string().trim().min(2).max(80), region: z.string().trim().max(50), active: z.boolean() });
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await updateProject(await requireUser(request), (await context.params).id, await parseJson(request, schema))); }
  catch (error) { return handleApiError(error); }
}
const deleteSchema = z.object({ updatedAt: z.string().datetime() });
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const input = await parseJson(request, deleteSchema);
    return NextResponse.json(await deleteProject(user, (await context.params).id, input.updatedAt));
  } catch (error) { return handleApiError(error); }
}
