import { permissionProjectIds } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { env, isWechatConfigured } from "@/lib/config";
import { requireUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const db = await getReadyDb();
    const projectIds = user.memberships.map((membership) => membership.projectId);
    const isGlobal =
      user.globalRole === "ADMIN" || user.globalRole === "FINANCE";
    const contextOnly = request.nextUrl.searchParams.get("scope") === "context";
    const [projects, suppliers, ingredients, contracts] = await Promise.all([
      db.project.findMany({
        where: {
          active: true,
          ...(isGlobal ? {} : { id: { in: projectIds } }),
        },
        orderBy: { code: "asc" },
      }),
      contextOnly ? Promise.resolve([]) : db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      contextOnly ? Promise.resolve([]) : db.ingredient.findMany({
        where: { active: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      contextOnly ? Promise.resolve([]) : db.contract.findMany({
        where: permissionProjectIds(user,"contract.view_price") === null ? {} : {projectId:{in:permissionProjectIds(user,"contract.view_price")!}},
        include: { supplier: true, ingredient: true, project: true },
        orderBy: { startsOn: "desc" },
      }),
    ]);
    return NextResponse.json({
      user,
      projects,
      suppliers,
      ingredients,
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
      system: {
        ocrMode: env.OCR_MODE,
        confidenceThreshold: env.OCR_CONFIDENCE_THRESHOLD,
        wechatConfigured: isWechatConfigured,
        storageDriver: env.STORAGE_DRIVER,
        thresholds: {
          crossPriceTolerance: env.CROSS_PRICE_TOLERANCE,
          historyPriceTolerance: env.HISTORY_PRICE_TOLERANCE,
          quantityOutlierMultiplier: env.QUANTITY_OUTLIER_MULTIPLIER,
          minBenchmarkSamples: env.MIN_BENCHMARK_SAMPLES,
        },
      },
    });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
