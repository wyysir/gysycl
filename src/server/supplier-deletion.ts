import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission } from "@/lib/permissions";
import { ApiError, type SessionUser } from "./auth";

export async function deleteSupplier(user: SessionUser, id: string, updatedAt: string) {
  if (!hasPermission(user, "master.manage")) throw new ApiError(403, "没有供应商维护权限");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    // Hold the parent row against concurrent document/contract references.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Supplier" WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) throw new ApiError(404, "供应商不存在");
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id }, include: { aliases: true } });
    if (supplier.updatedAt.toISOString() !== updatedAt) throw new ApiError(409, "供应商已变化，请刷新后重试");
    const [documents, contracts] = await Promise.all([
      tx.document.count({ where: { supplierId: id } }),
      tx.contract.count({ where: { supplierId: id } }),
    ]);
    if (documents || contracts) {
      throw new ApiError(409, "供应商已有关联单据或合同价，请停用供应商以保留业务记录", { documents, contracts });
    }
    await tx.supplier.delete({ where: { id } });
    await tx.auditLog.create({ data: {
      userId: user.id, entityType: "supplier", entityId: id, action: "supplier.deleted",
      beforeValue: { name: supplier.name, active: supplier.active, aliases: supplier.aliases.map(alias => alias.alias) },
      afterValue: { deleted: true, removedAliases: supplier.aliases.length },
    } });
    return { deleted: true };
  });
}
