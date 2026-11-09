import { hasPermission, permissionProjectIds } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { normalizeUnit, parseDateOnly } from "@/lib/text";
import { allowedProjectIds, isAdmin, requireOrigin, requireUser, ApiError } from "@/server/auth";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  projectId: z.string().min(1),
  supplierId: z.string().min(1),
  ingredientId: z.string().min(1),
  spec: z.string().max(100).optional().default(""),
  unit: z.string().min(1).max(30),
  unitPrice: z.number().positive().lt(10_000_000_000),
  startsOn: z.string().min(8),
  endsOn: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const requestedProjectId =
      request.nextUrl.searchParams.get("projectId")?.trim() || "";
    const allowed = permissionProjectIds(user,"contract.view_price");
    if (
      requestedProjectId &&
      allowed &&
      !allowed.includes(requestedProjectId)
    ) {
      throw new ApiError(403, "无权查看该项目点");
    }
    const db = await getReadyDb();
    const projectIds = requestedProjectId ? [requestedProjectId] : allowed;
    const contracts = await db.contract.findMany({
      where: projectIds ? { projectId: { in: projectIds } } : {},
      include: { project: true, supplier: true, ingredient: true },
      orderBy: { startsOn: "desc" },
    });
    return NextResponse.json({
      contracts: contracts.map((contract) => ({
        id: contract.id,
        updatedAt: contract.updatedAt.toISOString(),
        projectId: contract.projectId,
        projectName: contract.project.name,
        supplierId: contract.supplierId,
        supplierName: contract.supplier.name,
        ingredientId: contract.ingredientId,
        ingredientName: contract.ingredient.name,
        spec: contract.spec,
        unit: contract.unit,
        unitPrice: Number(contract.unitPrice),
        startsOn: contract.startsOn.toISOString(),
        endsOn: contract.endsOn?.toISOString() || null,
      })),
    });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const body = await parseJson(request, schema);
    if (!hasPermission(user,"contract.manage",body.projectId) || !hasPermission(user,"contract.view_price",body.projectId)) throw new ApiError(403,"当前角色没有该项目合同维护权限");
    const startsOn = parseDateOnly(body.startsOn);
    const endsOn = body.endsOn ? parseDateOnly(body.endsOn) : null;
    if (!startsOn) throw new ApiError(400, "生效日期无效");
    if (body.endsOn && !endsOn) throw new ApiError(400, "截止日期无效");
    if (endsOn && endsOn < startsOn) throw new ApiError(400, "截止日期不能早于生效日期");
    const db = await getReadyDb();
    const [project, supplier, ingredient] = await Promise.all([
      db.project.findUnique({ where: { id: body.projectId } }),
      db.supplier.findFirst({ where: { id: body.supplierId, active: true } }),
      db.ingredient.findFirst({ where: { id: body.ingredientId, active: true } }),
    ]);
    if (!project?.active || !supplier || !ingredient) {
      throw new ApiError(400, "项目点、供应商或原材料不存在");
    }
    const contract = await db.contract.create({
      data: {
        projectId: body.projectId,
        supplierId: body.supplierId,
        ingredientId: body.ingredientId,
        spec: body.spec,
        unit: normalizeUnit(body.unit),
        unitPrice: body.unitPrice,
        startsOn,
        endsOn,
        createdById: user.id,
      },
    });
    await db.auditLog.create({
      data: {
        entityType: "contract",
        entityId: contract.id,
        userId: user.id,
        action: "contract.created",
        afterValue: {
          project: project.name,
          supplier: supplier.name,
          ingredient: ingredient.name,
          unitPrice: body.unitPrice,
        },
      },
    });
    return NextResponse.json({ id: contract.id }, { status: 201 });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
