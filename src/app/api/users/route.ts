import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { hashPassword } from "@/lib/passwords";
import { ApiError, isAdmin, requireOrigin, requireUser } from "@/server/auth";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { membershipsSchema, membershipData, validateMemberships } from "@/server/memberships";

const schema = z.object({
  employeeNo: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(50),
  password: z.string().min(8).max(200),
  globalRole: z.enum(["ADMIN", "FINANCE", "STAFF"]).default("STAFF"),
  memberships: membershipsSchema.optional().default([]),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!isAdmin(user)) throw new ApiError(403, "只有管理员可以查看员工账号");
    const db = await getReadyDb();
    const users = await db.user.findMany({
      where: { deletedAt: null },
      include: {
        memberships: { include: { project: true, customRole: true } },
        wechatBinding: true,
      },
      orderBy: [{ active: "desc" }, { employeeNo: "asc" }],
    });
    return NextResponse.json({
      users: users.map((item) => ({
        id: item.id,
        employeeNo: item.employeeNo,
        name: item.name,
        globalRole: item.globalRole,
        active: item.active,
        wechatBound: Boolean(item.wechatBinding),
        memberships: item.memberships.map((membership) => ({
          projectId: membership.projectId,
          projectName: membership.project.name,
          role: membership.role,
          customRoleId: membership.customRoleId,
          roleName: membership.customRole?.name || (membership.role === "SUPERVISOR" ? "主管" : "员工"),
        })),
      })),
    });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    if (!isAdmin(user)) throw new ApiError(403, "只有管理员可以新增员工");
    const body = await parseJson(request, schema);
    const db = await getReadyDb();
    if (await db.user.findUnique({ where: { employeeNo: body.employeeNo } })) {
      throw new ApiError(409, "员工号已存在或已删除；历史员工号不能重复使用");
    }
    await validateMemberships(db, body.globalRole, body.memberships);
    const created = await db.$transaction(async (tx) => {
      const account = await tx.user.create({
        data: {
          employeeNo: body.employeeNo,
          name: body.name,
          passwordHash: hashPassword(body.password),
          globalRole: body.globalRole,
          memberships: {
            create: membershipData(body.memberships),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: "user",
          entityId: account.id,
          userId: user.id,
          action: "user.created",
          afterValue: {
            employeeNo: account.employeeNo,
            name: account.name,
            globalRole: account.globalRole,
            memberships: body.memberships,
          },
        },
      });
      return account;
    });
    return NextResponse.json(
      { id: created.id, employeeNo: created.employeeNo, name: created.name },
      { status: 201 },
    );
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
