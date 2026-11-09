import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission } from "@/lib/permissions";
import { ApiError } from "@/server/auth";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireOrigin } from "@/server/auth";
import { parseJson } from "@/server/http";
import { createSupplierFromDocument } from "@/server/master-commands";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  rawName: z.string().max(100).optional(),
  sourceDocumentId: z.string().optional(),
  contactName: z.string().max(50).optional(),
  contactPhone: z.string().max(30).optional(),
  confirmNew: z.literal(true),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const body = await parseJson(request, schema);
    return NextResponse.json(
      await createSupplierFromDocument(user, body),
      { status: 201 },
    );
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const all = request.nextUrl.searchParams.get("status") === "all";
    if (all && !hasPermission(user, "master.manage")) throw new ApiError(403, "没有供应商维护权限");
    const db = await getReadyDb();
    const suppliers = await db.supplier.findMany({where: all ? {} : {active: true}, include: {aliases: true}, orderBy: [{active: "desc"}, {name: "asc"}]});
    return NextResponse.json({suppliers: suppliers.map(row => ({...row, aliases: row.aliases.map(alias => alias.alias)}))});
  } catch (error) { const { handleApiError } = await import("@/server/http"); return handleApiError(error); }
}
