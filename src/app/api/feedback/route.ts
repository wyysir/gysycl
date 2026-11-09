import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { listFeedback, submitFeedback } from "@/server/feedback";
const schema = z.object({ content: z.string().trim().min(1).max(2000), contact: z.string().trim().max(100).default("") });
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await listFeedback(await requireUser(request)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return handleApiError(error); }
}
export async function POST(request: NextRequest) {
  try { const user = await requireUser(request); return NextResponse.json(await submitFeedback(user, await parseJson(request, schema)), { status: 201 }); }
  catch (error) { return handleApiError(error); }
}
