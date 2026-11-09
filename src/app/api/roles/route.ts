import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { ApiError, isAdmin, requireOrigin, requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { roleFields } from "@/server/custom-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    if (!isAdmin(await requireUser(request))) throw new ApiError(403,"只有管理员可以管理角色");
    const db=await getReadyDb();
    const roles=await db.customRole.findMany({orderBy:[{active:"desc"},{name:"asc"}],include:{_count:{select:{memberships:true}}}});
    return NextResponse.json({roles});
  } catch(error) { return handleApiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user=await requireUser(request); requireOrigin(request);
    if (!isAdmin(user)) throw new ApiError(403,"只有管理员可以管理角色");
    const body=await parseJson(request,z.object(roleFields));
    const db=await getReadyDb();
    const role=await db.$transaction(async tx=>{
      const created=await tx.customRole.create({data:body});
      await tx.auditLog.create({data:{entityType:"role",entityId:created.id,userId:user.id,action:"role.created",afterValue:body}});
      return created;
    });
    return NextResponse.json({role},{status:201});
  } catch(error) { return handleApiError(error); }
}
