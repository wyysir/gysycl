import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireOrigin } from "@/server/auth";
import {
  getDocumentDetail,
  saveDocument,
} from "@/server/document-service";
import { parseJson } from "@/server/http";
import { deleteDraft } from "@/server/document-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    return NextResponse.json(await getDocumentDetail(user, id));
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

const itemSchema = z.object({
  id: z.string().optional(),
  lineNo: z.number().optional(),
  name: z.string().max(100),
  rawName: z.string().max(100).optional(),
  spec: z.string().max(100).optional().default(""),
  unit: z.string().max(30).default(""),
  quantity: z.number().min(0).lt(10_000_000_000),
  unitPrice: z.number().min(0).lt(10_000_000_000).nullable(),
  amount: z.number().min(0).lt(10_000_000_000).nullable(),
  roundingConfirmed: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  ingredientId: z.string().nullable().optional(),
  matchStatus: z.enum(["MATCHED", "SIMILAR", "NEW", "UNMATCHED"]).optional(),
  matchScore: z.number().min(0).max(1).nullable().optional(),
});

const updateSchema = z.object({
  version: z.number().int().min(1),
  docNo: z.string().max(100).optional().default(""),
  docDate: z.string().min(8),
  projectId: z.string().min(1),
  supplierId: z.string().nullable().optional(),
  items: z.array(itemSchema).max(200),
  taxAmount: z.number().min(0).lt(10_000_000_000).nullable().optional().default(0),
  totalAmount: z.number().min(0).lt(10_000_000_000).nullable().optional(),
  notes: z.string().max(2000).optional().default(""),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const { id } = await context.params;
    const body = await parseJson(request, updateSchema);
    const result = await saveDocument(user, id, body);
    return NextResponse.json(result);
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const {id} = await context.params;
    const body = await parseJson(request, z.object({version: z.number().int().min(1)}));
    return NextResponse.json(await deleteDraft(user, id, body.version));
  } catch (error) {
    const {handleApiError} = await import("@/server/http");
    return handleApiError(error);
  }
}
