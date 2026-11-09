import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireOrigin } from "@/server/auth";
import { reviewDocument } from "@/server/document-service";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["approve", "return"]),
  note: z.string().max(2000).optional().default(""),
  override: z.boolean().optional().default(false),
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
    return NextResponse.json(await reviewDocument(user, id, body));
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
