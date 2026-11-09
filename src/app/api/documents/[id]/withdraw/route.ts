import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireOrigin, requireUser } from "@/server/auth";
import { withdrawApproval } from "@/server/document-service";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";

const schema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const { id } = await context.params;
    const body = await parseJson(request, schema);
    return NextResponse.json(await withdrawApproval(user, id, body));
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
