import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {requireUser} from "@/server/auth";
import {deleteDraftPage} from "@/server/document-deletion";
import {handleApiError, parseJson} from "@/server/http";

export const runtime = "nodejs";
export async function DELETE(request: NextRequest, context: {params: Promise<{id: string; pageId: string}>}) {
  try {
    const user = await requireUser(request);
    const {id, pageId} = await context.params;
    const body = await parseJson(request, z.object({version: z.number().int().min(1)}));
    return NextResponse.json(await deleteDraftPage(user, id, pageId, body.version));
  } catch (error) {
    return handleApiError(error);
  }
}
