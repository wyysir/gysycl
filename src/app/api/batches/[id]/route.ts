import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireOrigin, requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { batchUploadTarget, completeBatchPhoto, confirmBatchDocument, getBatch, submitBatch } from "@/server/batches";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{id:string}> };
export async function GET(request: NextRequest, context: Context) {
  try { return NextResponse.json(await getBatch(await requireUser(request),(await context.params).id)); }
  catch(error) { return handleApiError(error); }
}
const position = z.number().int().min(1).max(10);
const schema = z.discriminatedUnion("action",[
  z.object({action:z.literal("upload-target"),position,mime:z.enum(["image/jpeg","image/png","image/webp"])}),
  z.object({action:z.literal("complete"),position}),
  z.object({action:z.literal("confirm"),documentId:z.string().min(1),version:z.number().int().min(1)}),
  z.object({action:z.literal("submit"),documents:z.array(z.object({id:z.string().min(1),version:z.number().int().min(1)})).min(1).max(10)}),
]);
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await requireUser(request); requireOrigin(request);
    const id = (await context.params).id, input = await parseJson(request,schema);
    if(input.action==="upload-target") return NextResponse.json(await batchUploadTarget(user,id,input.position,input.mime));
    if(input.action==="complete") return NextResponse.json(await completeBatchPhoto(user,id,input.position));
    if(input.action==="confirm") return NextResponse.json(await confirmBatchDocument(user,id,input.documentId,input.version));
    return NextResponse.json(await submitBatch(user,id,input.documents));
  } catch(error) { return handleApiError(error); }
}
