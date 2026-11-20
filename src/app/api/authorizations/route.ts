import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { effectiveGrants, hasPermission } from "@/lib/permissions";
import { requireUser, requireOrigin, userInclude, toSessionUser, ApiError } from "@/server/auth";
import { grantsSchema, saveAuthorization } from "@/server/authorizations";
import { handleApiError, parseJson } from "@/server/http";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{
  const actor=await requireUser(request);if(!hasPermission(actor,"grant.manage"))throw new ApiError(403,"没有人员授权管理权限");
  const db=await getReadyDb();const [rows,projects,templates]=await Promise.all([db.user.findMany({where:{deletedAt:null},include:userInclude(),orderBy:{employeeNo:"asc"}}),db.project.findMany({select:{id:true,name:true,active:true}}),db.customRole.findMany({where:{active:true},select:{id:true,name:true,permissions:true}})]);
  return NextResponse.json({users:await Promise.all(rows.map(async row=>({id:row.id,name:row.name,employeeNo:row.employeeNo,active:row.active,version:row.authorizationVersion,grants:effectiveGrants(await toSessionUser(row))}))),projects,templates});
}catch(e){return handleApiError(e);}}
export async function PUT(request:NextRequest){try{const actor=await requireUser(request);requireOrigin(request);const input=await parseJson(request,z.object({userId:z.string().min(1),version:z.number().int().positive(),grants:grantsSchema}));return NextResponse.json(await saveAuthorization(actor,input));}catch(e){return handleApiError(e);}}
