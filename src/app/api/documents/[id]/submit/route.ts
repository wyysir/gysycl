import { NextResponse, type NextRequest } from "next/server";
import { requireUser, requireOrigin } from "@/server/auth";
import { submitDocument } from "@/server/document-service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const { id } = await context.params;
    return NextResponse.json(await submitDocument(user, id));
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
