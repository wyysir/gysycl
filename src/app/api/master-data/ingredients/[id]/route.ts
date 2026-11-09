import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { getIngredient, updateIngredient } from "@/server/ingredients";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(30),
  spec: z.string().trim().max(100).optional(),
  category: z.string().max(50).default(""),
  aliases: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  notes: z.string().max(2000).default(""),
  active: z.boolean(),
});
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(
      await getIngredient(
        await requireUser(request),
        (await context.params).id,
      ),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request),
      body = await parseJson(request, schema);
    return NextResponse.json(
      await updateIngredient(user, (await context.params).id, body),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
