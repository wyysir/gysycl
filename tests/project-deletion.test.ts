import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { createSessionToken, type SessionUser } from "@/server/auth";
import { createBatch } from "@/server/batches";
import { deleteProject } from "@/server/project-deletion";
import { DELETE } from "@/app/api/projects/[id]/route";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const ids: string[] = [];
async function project() {
  const db = await getReadyDb();
  const row = await db.project.create({ data: { code: "DEL-" + randomUUID(), name: "删除项目回归" + randomUUID() } });
  ids.push(row.id); return row;
}
afterEach(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { projectId: { in: ids } } });
  const batches = await db.uploadBatch.findMany({ where: { projectId: { in: ids } } });
  await db.batchPhoto.deleteMany({ where: { batchId: { in: batches.map(row => row.id) } } });
  await db.uploadBatch.deleteMany({ where: { projectId: { in: ids } } });
  await db.projectDailyRevenue.deleteMany({ where: { projectId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { entityType: "project", entityId: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
  ids.length = 0;
});

describe("项目点删除保护", () => {
  it("只有管理员可删除，拒绝过期版本且不改项目", async () => {
    const row = await project();
    for (const globalRole of ["STAFF", "FINANCE"] as const) await expect(deleteProject({ ...admin, globalRole }, row.id, row.updatedAt.toISOString())).rejects.toMatchObject({ status: 403 });
    await expect(deleteProject(admin, row.id, new Date(0).toISOString())).rejects.toMatchObject({ status: 409 });
    expect(await (await getReadyDb()).project.findUnique({ where: { id: row.id } })).toMatchObject({ name: row.name });
    await expect(deleteProject(admin, "missing", row.updatedAt.toISOString())).rejects.toMatchObject({ status: 404 });
  });

  it("删除空项目及其授权，保留员工和其他项目，记录审计", async () => {
    const db = await getReadyDb(), row = await project(), other = await project();
    const beforeUser = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    await db.projectMembership.create({ data: { projectId: row.id, userId: admin.id, role: "SUPERVISOR" } });
    await deleteProject(admin, row.id, row.updatedAt.toISOString());
    expect(await db.project.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await db.projectMembership.count({ where: { projectId: row.id } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: admin.id } })).toEqual(beforeUser);
    expect(await db.project.findUnique({ where: { id: other.id } })).toEqual(other);
    expect(await db.auditLog.findFirst({ where: { entityId: row.id, action: "project.deleted" } })).toMatchObject({ afterValue: { deleted: true, removedMemberships: 1 } });
  });

  it.each(["单据", "合同价", "营业额", "上传批次"])("存在%s时拒绝且不级联删除业务", async kind => {
    const db = await getReadyDb(), row = await project();
    if (kind === "单据") await db.document.create({ data: { projectId: row.id, createdById: admin.id, docDate: new Date("2026-11-19"), status: "DRAFT" } });
    if (kind === "合同价") {
      const supplier = await db.supplier.findFirstOrThrow(), ingredient = await db.ingredient.findFirstOrThrow();
      await db.contract.create({ data: { projectId: row.id, supplierId: supplier.id, ingredientId: ingredient.id, unit: ingredient.unit, unitPrice: 10, startsOn: new Date("2026-11-19") } });
    }
    if (kind === "营业额") await db.projectDailyRevenue.create({ data: { projectId: row.id, date: new Date("2026-11-19"), amount: 100, createdById: admin.id, updatedById: admin.id } });
    if (kind === "上传批次") await createBatch(admin, { requestId: randomUUID(), projectId: row.id, docDate: "2026-11-19", fileNames: ["test.jpg"] });
    const before = await Promise.all([db.document.count({ where: { projectId: row.id } }), db.contract.count({ where: { projectId: row.id } }), db.projectDailyRevenue.count({ where: { projectId: row.id } }), db.uploadBatch.count({ where: { projectId: row.id } })]);
    await expect(deleteProject(admin, row.id, row.updatedAt.toISOString())).rejects.toMatchObject({ status: 409 });
    expect(await db.project.findUnique({ where: { id: row.id } })).not.toBeNull();
    expect(await Promise.all([db.document.count({ where: { projectId: row.id } }), db.contract.count({ where: { projectId: row.id } }), db.projectDailyRevenue.count({ where: { projectId: row.id } }), db.uploadBatch.count({ where: { projectId: row.id } })])).toEqual(before);
  });

  it("删除后旧页面不能再为该项目创建批次", async () => {
    const db = await getReadyDb(), row = await project();
    await deleteProject(admin, row.id, row.updatedAt.toISOString());
    await expect(createBatch(admin, { requestId: randomUUID(), projectId: row.id, docDate: "2026-11-19", fileNames: ["test.jpg"] })).rejects.toMatchObject({ status: 400 });
    expect(await db.uploadBatch.count({ where: { projectId: row.id } })).toBe(0);
  });

  it("DELETE接口校验登录、来源和版本，正确处理异步路由参数", async () => {
    const row = await project(), token = await createSessionToken(admin.id);
    const request = (body: unknown, origin = "http://localhost:3000", signed = true) => new NextRequest(`http://localhost:3000/api/projects/${row.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", Origin: origin, ...(signed ? { Cookie: `delivery_session=${token}` } : {}) }, body: JSON.stringify(body) });
    const context = { params: Promise.resolve({ id: row.id }) }, body = { updatedAt: row.updatedAt.toISOString() };
    expect((await DELETE(request(body, undefined, false), context)).status).toBe(401);
    expect((await DELETE(request(body, "https://external.example"), context)).status).toBe(403);
    expect((await DELETE(request({}), context)).status).toBe(400);
    expect((await DELETE(request(body), context)).status).toBe(200);
    expect((await DELETE(request(body), context)).status).toBe(404);
  });
});
