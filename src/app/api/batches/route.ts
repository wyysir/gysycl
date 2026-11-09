import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireOrigin, requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { createBatch, listBatches } from "@/server/batches";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await listBatches(await requireUser(request))); }
  catch(error) { return handleApiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request); requireOrigin(request);
    const input = await parseJson(request,z.object({requestId:z.string().uuid(),projectId:z.string().min(1),docDate:z.string().min(8),fileNames:z.array(z.string().min(1).max(255)).min(1).max(10)}));
    return NextResponse.json(await createBatch(user,input));
  } catch(error) { return handleApiError(error); }
}
