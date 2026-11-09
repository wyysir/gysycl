import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireOrigin } from "@/server/auth";
import { parseJson } from "@/server/http";
import { mergeMasterData } from "@/server/master-commands";

export const runtime = "nodejs";

const schema = z.object({
  type: z.enum(["supplier", "ingredient"]),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const body = await parseJson(request, schema);
    return NextResponse.json(await mergeMasterData(user, body));
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
