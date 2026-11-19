import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { updateSupplier } from "@/server/master-maintenance";
import { deleteSupplier } from "@/server/supplier-deletion";
export const runtime = "nodejs";
const schema = z.object({
  updatedAt: z.string().datetime(), name: z.string().trim().min(1).max(100),
  contactName: z.string().trim().max(50), contactPhone: z.string().trim().max(30),
  aliases: z.array(z.string().trim().min(1).max(100)).max(50), active: z.boolean(),
});
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await updateSupplier(await requireUser(request), (await context.params).id, await parseJson(request, schema)));
  } catch (error) { return handleApiError(error); }
}
const deleteSchema = z.object({ updatedAt: z.string().datetime() });
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const input = await parseJson(request, deleteSchema);
    return NextResponse.json(await deleteSupplier(user, (await context.params).id, input.updatedAt));
  } catch (error) { return handleApiError(error); }
}
