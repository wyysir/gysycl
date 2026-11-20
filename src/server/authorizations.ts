import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { PERMISSION_KEYS, companyPermission, effectiveGrants, hasPermission } from "@/lib/permissions";
import { getReadyDb } from "@/lib/bootstrap";
import { ApiError, toSessionUser, userInclude, type SessionUser } from "./auth";

type Tx = Prisma.TransactionClient;
export const grantsSchema=z.array(z.object({key:z.enum(PERMISSION_KEYS),scope:z.string().min(1).max(100)})).max(10000).superRefine((rows,ctx)=>{
  if(new Set(rows.map(g=>g.key+":"+g.scope)).size!==rows.length)ctx.addIssue({code:"custom",message:"权限不可重复"});
  if(rows.some(g=>companyPermission(g.key)&&g.scope!=="*"))ctx.addIssue({code:"custom",message:"公司级权限必须明确授予公司范围"});
});
export async function authorizationLock(tx:Tx){await tx.$executeRaw`SELECT pg_advisory_xact_lock(19261120)`;}
export async function assertCurrentAuthorization(tx:Tx,id:string,key:Parameters<typeof hasPermission>[1],projectId?:string,financial=false){
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR SHARE`;
  const row=await tx.user.findUnique({where:{id},include:userInclude()});
  const current=row?await toSessionUser(row):null;
  if(!row||!row.active||row.deletedAt||!current||!hasPermission(current,key,projectId)||financial&&!hasPermission(current,"document.view_amount",projectId))throw new ApiError(403,"当前账号已失去此项权限，请刷新后重试");
}
export async function assertGrantManagerRemains(tx:Tx){
  const users=await tx.user.findMany({where:{active:true,deletedAt:null},include:userInclude()});
  for(const user of users)if(hasPermission(await toSessionUser(user),"grant.manage"))return;
  throw new ApiError(409,"至少保留一名在用的授权管理者，请先完成授权移交");
}
export async function saveAuthorization(actor:SessionUser,input:{userId:string;version:number;grants:z.infer<typeof grantsSchema>}){
  if(!hasPermission(actor,"grant.manage"))throw new ApiError(403,"未获人员授权管理权限");
  const grants=grantsSchema.parse(input.grants),db=await getReadyDb();
  return db.$transaction(async tx=>{
    await authorizationLock(tx);await assertCurrentAuthorization(tx,actor.id,"grant.manage");
    const target=await tx.user.findUnique({where:{id:input.userId},include:userInclude()});
    if(!target||target.deletedAt)throw new ApiError(404,"人员不存在或已删除");
    if(target.authorizationVersion!==input.version)throw new ApiError(409,"授权已被其他人修改，请刷新");
    const ids=[...new Set(grants.map(g=>g.scope).filter(s=>s!=="*"))];
    if(await tx.project.count({where:{id:{in:ids}}})!==ids.length)throw new ApiError(400,"授权项目不存在");
    await tx.user.update({where:{id:target.id},data:{accessGrants:grants,authorizationVersion:{increment:1}}});
    await assertGrantManagerRemains(tx);
    await tx.auditLog.create({data:{userId:actor.id,entityType:"authorization",entityId:target.id,action:"authorization.saved",beforeValue:effectiveGrants(await toSessionUser(target)),afterValue:grants}});
    return {version:input.version+1,grants};
  });
}
