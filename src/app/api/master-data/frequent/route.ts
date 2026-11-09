import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { handleApiError } from "@/server/http";
import { frequentMaterials } from "@/server/frequent-materials";

export async function GET(request: NextRequest) {
  try { return NextResponse.json({ items: await frequentMaterials(await requireUser(request)) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return handleApiError(error); }
}
