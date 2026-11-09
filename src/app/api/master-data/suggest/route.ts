import { NextResponse, type NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { requireUser } from "@/server/auth";
import { suggestIngredients, suggestSuppliers } from "@/server/master-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
    const type = request.nextUrl.searchParams.get("type");
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    if (!q) return NextResponse.json({ suggestions: [] });
    const db = await getReadyDb();
    const suggestions =
      type === "supplier"
        ? await suggestSuppliers(db, q)
        : await suggestIngredients(db, q);
    return NextResponse.json({ suggestions });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
