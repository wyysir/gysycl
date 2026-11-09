import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { bulkMaintainIngredients } from "@/server/ingredient-maintenance";
export const runtime = "nodejs";
const schema = z.object({ items: z.array(z.object({ id: z.string().min(1), version: z.number().int().positive() })).min(1).max(200), active: z.boolean().optional(), category: z.string().trim().max(50).optional() });
export async function PATCH(request: NextRequest) {
  try { return NextResponse.json(await bulkMaintainIngredients(await requireUser(request), await parseJson(request, schema))); }
  catch (error) { return handleApiError(error); }
}
