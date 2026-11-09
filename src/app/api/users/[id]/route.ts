import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { hashPassword } from "@/lib/passwords";
import { ApiError, isAdmin, requireOrigin, requireUser } from "@/server/auth";
import { parseJson } from "@/server/http";
import { membershipsSchema, membershipData, validateMemberships } from "@/server/memberships";

export const runtime = "nodejs";

const schema = z.object({
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  memberships: membershipsSchema.optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    if (!isAdmin(user)) throw new ApiError(403, "只有管理员可以修改员工");
    const { id } = await context.params;
    const body = await parseJson(request, schema);
    if (id === user.id && body.active === false) {
      throw new ApiError(400, "不能停用当前登录账号");
    }
    const db = await getReadyDb();
    const updated = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE "globalRole" = 'ADMIN' ORDER BY id FOR UPDATE`;
      const currentActor = await tx.user.findUnique({ where: { id: user.id } });
      if (!currentActor?.active || currentActor.deletedAt || currentActor.globalRole !== "ADMIN") throw new ApiError(403, "当前账号已失去管理权限");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id }, include: { memberships: true } });
      if (!target || target.deletedAt) throw new ApiError(404, "员工不存在或已删除");
      if (body.memberships !== undefined) await validateMemberships(tx, target.globalRole, body.memberships, target.memberships);
      const account = await tx.user.update({
      where: { id },
      data: {
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(body.password ? { passwordHash: hashPassword(body.password) } : {}),
        ...(body.memberships === undefined ? {} : { memberships: {
          deleteMany: {}, create: membershipData(body.memberships),
        } }),
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "user",
        entityId: id,
        userId: user.id,
        action: "user.updated",
        beforeValue: { active: target.active, memberships: target.memberships.map(({projectId,role,customRoleId}) => ({projectId,role,customRoleId})) },
        afterValue: {
          active: account.active,
          passwordReset: Boolean(body.password),
          ...(body.memberships === undefined ? {} : { memberships: body.memberships }),
        },
      },
    });
    return account;
    });
    return NextResponse.json({ id: updated.id, active: updated.active });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    requireOrigin(request);
    if (!isAdmin(actor)) throw new ApiError(403, "只有管理员可以删除员工账号");
    const { id } = await context.params;
    if (id === actor.id) throw new ApiError(400, "不能删除当前登录账号");
    const db = await getReadyDb();
    await db.$transaction(async tx => {
      // Serialize account deletion and recheck the actor after acquiring locks.
      await tx.$queryRaw`SELECT id FROM "User" WHERE "globalRole" = 'ADMIN' ORDER BY id FOR UPDATE`;
      const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
      if (!currentActor?.active || currentActor.deletedAt || currentActor.globalRole !== "ADMIN") throw new ApiError(403, "当前账号已失去管理权限");
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.deletedAt) throw new ApiError(404, "员工不存在或已删除");
      const deletedAt = new Date();
      await tx.user.update({ where: { id }, data: { active: false, deletedAt } });
      await tx.auditLog.create({ data: {
        entityType: "user", entityId: id, userId: actor.id, action: "user.deleted",
        beforeValue: { employeeNo: target.employeeNo, name: target.name, globalRole: target.globalRole, active: target.active },
        afterValue: { active: false, deletedAt: deletedAt.toISOString(), historicalRecordsRetained: true },
      } });
    });
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
