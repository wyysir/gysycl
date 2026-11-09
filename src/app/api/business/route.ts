import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handleApiError, parseJson } from "@/server/http";
import { getBusiness, saveRevenue } from "@/server/business";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
  try { const user=await requireUser(request); return NextResponse.json(await getBusiness(user,Object.fromEntries(request.nextUrl.searchParams))); }
  catch(e) {return handleApiError(e);}
}
export async function PATCH(request:NextRequest) {
  try { const user=await requireUser(request); const input=await parseJson(request,z.object({projectId:z.string().min(1),date:z.string(),amount:z.number(),notes:z.string().max(2000),version:z.number().int().min(0)})); return NextResponse.json(await saveRevenue(user,input)); }
  catch(e) {return handleApiError(e);}
}
