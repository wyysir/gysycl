import { authorizationLock, assertCurrentAuthorization, assertGrantManagerRemains } from "@/server/authorizations";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission } from "@/lib/permissions";
import { ApiError, type SessionUser } from "./auth";

export const bulkSchema = z.object({
  action: z.enum(["enable", "disable", "delete"]),
  items: z.array(z.object({ id: z.string().min(1).max(100), updatedAt: z.string().datetime().optional(), version: z.number().int().positive().optional() })).min(1).max(200),
});
export type BulkKind = "supplier" | "project" | "user" | "ingredient";
const labels = { supplier: "供应商", project: "项目点", user: "员工", ingredient: "原材料" };

/** One transaction for the entire selection: a failed guard rolls back every row and audit. */
export async function bulkMaintain(user: SessionUser, kind: BulkKind, input: z.infer<typeof bulkSchema>) {
  input = bulkSchema.parse(input);
  if (kind === "user" || kind === "project") {
    if (!hasPermission(user, kind === "user" ? "user.manage" : "project.manage")) throw new ApiError(403, "只有管理员可以维护员工和项目点");
  } else if (!hasPermission(user, "master.manage")) throw new ApiError(403, "没有基础资料维护权限");
  if (new Set(input.items.map(item => item.id)).size !== input.items.length) throw new ApiError(400, "不能重复选择，整批未保存");
  if (input.items.some(item => kind === "ingredient" ? item.version === undefined : !item.updatedAt)) throw new ApiError(400, "缺少资料版本，请刷新后重试");
  if (kind === "user" && input.action !== "enable" && input.items.some(item => item.id === user.id)) throw new ApiError(400, "不能停用或删除当前登录账号，整批未保存");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    if (kind === "user") {
      // Same lock order as individual account changes, including actor revalidation.
      await authorizationLock(tx);
      const actor = await tx.user.findUnique({ where: { id: user.id } });
      await assertCurrentAuthorization(tx,user.id,"user.manage");
    }
    for (const item of [...input.items].sort((a, b) => a.id.localeCompare(b.id))) {
      const id = item.id;
      // Parent locks also prevent a reference being added between guard and delete.
      if (kind === "supplier") await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${id} FOR UPDATE`;
      else if (kind === "project") await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${id} FOR UPDATE`;
      else if (kind === "user") await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "Ingredient" WHERE id = ${id} FOR UPDATE`;
      const row = kind === "supplier" ? await tx.supplier.findUnique({ where: { id } }) : kind === "project" ? await tx.project.findUnique({ where: { id } }) : kind === "user" ? await tx.user.findUnique({ where: { id } }) : await tx.ingredient.findUnique({ where: { id } });
      if (!row || ("deletedAt" in row && row.deletedAt)) throw new ApiError(409, `${labels[kind]}不存在或已删除，请刷新，整批未保存`);
      if (kind === "ingredient" ? !("version" in row) || row.version !== item.version : row.updatedAt.toISOString() !== item.updatedAt) throw new ApiError(409, `${row.name}已变化，请刷新后重新选择，整批未保存`);
      const deleting = input.action === "delete", active = input.action === "enable";
      if (deleting) {
        const used = kind === "supplier" ? await tx.document.count({ where: { supplierId: id } }) + await tx.contract.count({ where: { supplierId: id } })
          : kind === "project" ? await tx.document.count({ where: { projectId: id } }) + await tx.contract.count({ where: { projectId: id } }) + await tx.projectDailyRevenue.count({ where: { projectId: id } }) + await tx.uploadBatch.count({ where: { projectId: id } })
          : kind === "ingredient" ? await tx.documentItem.count({ where: { ingredientId: id } }) + await tx.contract.count({ where: { ingredientId: id } }) : 0;
        const supplierUsed=kind==="supplier"?await tx.supplierAdjustment.count({where:{supplierId:id}})+await tx.supplierStatement.count({where:{supplierId:id}})+await tx.supplierFile.count({where:{supplierId:id}}):kind==="project"?await tx.supplierAdjustment.count({where:{projectId:id}})+await tx.supplierStatement.count({where:{projectId:id}})+await tx.supplierFile.count({where:{projectId:id}}):kind==="ingredient"?await tx.supplierAdjustment.count({where:{ingredientId:id}}):0;
        if (used || supplierUsed) throw new ApiError(409, `${row.name}已有业务关联，请改用停用，整批未删除`);
        if (kind === "supplier") await tx.supplier.delete({ where: { id } });
        else if (kind === "project") await tx.project.delete({ where: { id } });
        else if (kind === "ingredient") await tx.ingredient.delete({ where: { id } });
        else await tx.user.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
      } else {
        const data = { active, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) };
        if (kind === "supplier") await tx.supplier.update({ where: { id }, data });
        else if (kind === "project") await tx.project.update({ where: { id }, data });
        else if (kind === "user") await tx.user.update({ where: { id }, data });
        else await tx.ingredient.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      }
      await tx.auditLog.create({ data: { userId: user.id, entityType: kind, entityId: id, action: `${kind}.bulk${deleting ? "Deleted" : active ? "Enabled" : "Disabled"}`, beforeValue: { name: row.name, active: row.active }, afterValue: deleting ? { deleted: true, historicalRecordsRetained: kind === "user" } : { active } } });
    }
    if(kind === "user")await assertGrantManagerRemains(tx);
    return { processed: input.items.length };
  }, { timeout: 30000 });
}
