import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { updateSupplier } from "@/server/master-maintenance";
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
