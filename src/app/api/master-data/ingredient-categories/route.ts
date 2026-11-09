import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { ingredientCategories, maintainCategory } from "@/server/ingredient-maintenance";
export const runtime = "nodejs";
const schema = z.object({ name: z.string().trim().min(1).max(50), previousName: z.string().min(1).max(50).optional(), active: z.boolean(), version: z.string() });
export async function GET(request: NextRequest) {
  try { await requireUser(request); return NextResponse.json(await ingredientCategories()); }
  catch (error) { return handleApiError(error); }
}
export async function POST(request: NextRequest) {
  try { return NextResponse.json(await maintainCategory(await requireUser(request), await parseJson(request, schema))); }
  catch (error) { return handleApiError(error); }
}
