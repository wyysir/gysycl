import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireOrigin } from "@/server/auth";
import { parseJson } from "@/server/http";
import { createIngredientFromDocument } from "@/server/master-commands";
import { listIngredients } from "@/server/ingredients";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  rawName: z.string().max(100).optional(),
  spec: z.string().max(100).optional().default(""),
  unit: z.string().trim().min(1).max(30),
  category: z.string().max(50).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
  aliases: z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .optional()
    .default([]),
  active: z.boolean().optional().default(true),
  sourceDocumentId: z.string().optional(),
  sourceItemId: z.string().optional(),
  confirmNew: z.literal(true),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request),
      p = request.nextUrl.searchParams;
    return NextResponse.json(
      await listIngredients(user, {
        q: p.get("q") || "",
        unit: p.get("unit") || "",
        category: p.get("category") || "",
        status: p.get("status") || "active",
        page: p.get("page") || 1,
      }),
    );
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const body = await parseJson(request, schema);
    return NextResponse.json(await createIngredientFromDocument(user, body), {
      status: 201,
    });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
