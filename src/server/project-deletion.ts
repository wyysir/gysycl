import { hasPermission } from "@/lib/permissions";
import { getReadyDb } from "@/lib/bootstrap";
import { ApiError, type SessionUser } from "./auth";

export async function deleteProject(user: SessionUser, id: string, updatedAt: string) {
  if (!hasPermission(user,"project.manage")) throw new ApiError(403, "只有管理员可以删除项目点");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    // Batch creation holds a shared parent lock through its write, because
    // UploadBatch.projectId has no foreign key in the existing schema.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Project" WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) throw new ApiError(404, "项目点不存在");
    const project = await tx.project.findUniqueOrThrow({ where: { id } });
    if (project.updatedAt.toISOString() !== updatedAt) throw new ApiError(409, "项目点已变化，请刷新后重试");
    const [documents, contracts, revenues, batches, memberships] = await Promise.all([
      tx.document.count({ where: { projectId: id } }),
      tx.contract.count({ where: { projectId: id } }),
      tx.projectDailyRevenue.count({ where: { projectId: id } }),
      tx.uploadBatch.count({ where: { projectId: id } }),
      tx.projectMembership.count({ where: { projectId: id } }),
    ]);
    if (documents || contracts || revenues || batches || await tx.supplierAdjustment.count({where:{projectId:id}}) || await tx.supplierStatement.count({where:{projectId:id}}) || await tx.supplierFile.count({where:{projectId:id}})) {
      throw new ApiError(409, "项目点已有单据、合同价、营业额或上传批次，请停用项目点以保留业务记录", { documents, contracts, revenues, batches });
    }
    await tx.project.delete({ where: { id } });
    await tx.auditLog.create({ data: {
      userId: user.id, entityType: "project", entityId: id, action: "project.deleted",
      beforeValue: { code: project.code, name: project.name, region: project.region, active: project.active, memberships },
      afterValue: { deleted: true, removedMemberships: memberships },
    } });
    return { deleted: true };
  });
}
