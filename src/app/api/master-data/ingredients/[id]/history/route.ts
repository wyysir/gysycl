import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { handleApiError } from "@/server/http";
import { ingredientHistory } from "@/server/ingredients";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request),
      params = request.nextUrl.searchParams;
    return NextResponse.json(
      await ingredientHistory(user, (await context.params).id, {
        page: params.get("page") || 1,
        from: params.get("from") || "",
        to: params.get("to") || "",
        projectId: params.get("projectId") || "",
        supplierId: params.get("supplierId") || "",
        unit: params.get("unit") || "",
        spec: params.has("spec") ? params.get("spec")! : undefined,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
