import { requireMasterReader } from "@/server/master-reader";
import { productSpecification } from "@/lib/text";
import { NextResponse, type NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { requireUser } from "@/server/auth";
import { handleApiError } from "@/server/http";
import { createMaterialCatalogue, materialGroupKey } from "@/server/material-catalogue";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await requireMasterReader(request);
    const ingredientId = request.nextUrl.searchParams.get("ingredientId");
    const q = request.nextUrl.searchParams.get("q")?.trim() || "", key = request.nextUrl.searchParams.get("key");
    if ((ingredientId?.length || 0) > 100 || q.length > 100 || (key?.length || 0) > 500) return NextResponse.json({ error: "检索条件过长" }, { status: 400 });
    if (!q && !key && !ingredientId) return NextResponse.json({ groups: [] });
    const catalogue = await createMaterialCatalogue(await getReadyDb());
    const record = ingredientId ? catalogue.rows.find(r => r.id === ingredientId) : null;
    const selectedKey = key || (record ? materialGroupKey(record.name, productSpecification(record.spec, record.unit)) : null);
    return NextResponse.json({ groups: selectedKey ? [catalogue.groups.get(selectedKey)].filter(Boolean) : catalogue.search(q) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleApiError(error); }
}
