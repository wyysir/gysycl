import { z } from "zod";
import { parseJson } from "@/server/http";
import { updateContract } from "@/server/master-maintenance";
import { hasPermission } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { isAdmin, requireOrigin, requireUser, ApiError } from "@/server/auth";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);

    const { id } = await context.params;
    const db = await getReadyDb();
    const contract = await db.contract.findUnique({ where: { id } });
    if (!contract) throw new ApiError(404, "合同价不存在");
    if (!hasPermission(user,"contract.manage",contract.projectId) || !hasPermission(user,"contract.view_price",contract.projectId)) throw new ApiError(403,"当前角色没有该项目合同维护权限");
    await db.contract.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        entityType: "contract",
        entityId: id,
        userId: user.id,
        action: "contract.deleted",
        beforeValue: {
          projectId: contract.projectId,
          supplierId: contract.supplierId,
          ingredientId: contract.ingredientId,
          unitPrice: Number(contract.unitPrice),
        },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

const updateSchema = z.object({
  updatedAt: z.string().datetime(), projectId: z.string().min(1), supplierId: z.string().min(1), ingredientId: z.string().min(1),
  unitPrice: z.number().positive().lt(10_000_000_000), startsOn: z.string().min(8), endsOn: z.string().nullable().optional(),
});
export async function PATCH(request: NextRequest, context: {params: Promise<{id: string}>}) {
  try { return NextResponse.json(await updateContract(await requireUser(request), (await context.params).id, await parseJson(request, updateSchema))); }
  catch (error) { const {handleApiError} = await import("@/server/http"); return handleApiError(error); }
}
