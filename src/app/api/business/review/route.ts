import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { reviewRevenue } from "@/server/business";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const input = await parseJson(request, z.object({ id: z.string().min(1), version: z.number().int().min(1), action: z.enum(["approve", "return"]), note: z.string().max(2000) }));
    return NextResponse.json(await reviewRevenue(user, input));
  } catch (error) { return handleApiError(error); }
}
