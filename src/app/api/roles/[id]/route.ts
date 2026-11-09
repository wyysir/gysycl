import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { ApiError, isAdmin, requireOrigin, requireUser } from "@/server/auth";
import { parseJson, handleApiError } from "@/server/http";
import { roleFields } from "@/server/custom-roles";

export const runtime = "nodejs";
const schema=z.object({...roleFields,active:z.boolean(),version:z.number().int().positive()});
export async function PATCH(request:NextRequest,context:{params:Promise<{id:string}>}) {
  try {
    const user=await requireUser(request);requireOrigin(request);
    if(!isAdmin(user))throw new ApiError(403,"只有管理员可以管理角色");
    const {id}=await context.params;const body=await parseJson(request,schema);
    const db=await getReadyDb();
    const role=await db.$transaction(async tx=>{
      const before=await tx.customRole.findUnique({where:{id}});
      if(!before)throw new ApiError(404,"角色不存在");
      const {version,...data}=body;
      const changed=await tx.customRole.updateMany({where:{id,version},data:{...data,version:{increment:1}}});
      if(changed.count!==1)throw new ApiError(409,"角色已被修改，请刷新后重试");
      await tx.auditLog.create({data:{entityType:"role",entityId:id,userId:user.id,action:"role.updated",
        beforeValue:{name:before.name,permissions:before.permissions,active:before.active,version:before.version},afterValue:body}});
      return tx.customRole.findUniqueOrThrow({where:{id}});
    });
    return NextResponse.json({role});
  } catch(error) {return handleApiError(error);}
}
