import { NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { handleApiError,binaryResponse } from "@/server/http";
import { exportSupplierBusiness } from "@/server/supplier-export";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{const user=await requireUser(request),q=request.nextUrl.searchParams;const bytes=await exportSupplierBusiness(user,q.get("projectId")||"",q.get("supplierId")||"",q.get("from")||"",q.get("to")||"");return binaryResponse(bytes,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",{"Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent("供应商对账.xlsx")});}catch(e){return handleApiError(e);}}
