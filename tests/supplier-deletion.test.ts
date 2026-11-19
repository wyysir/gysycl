import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { normalizeName } from "@/lib/text";
import { createSessionToken, type SessionUser } from "@/server/auth";
import { deleteSupplier } from "@/server/supplier-deletion";
import { DELETE } from "@/app/api/master-data/suppliers/[id]/route";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const ids: string[] = [], documents: string[] = [], contracts: string[] = [];
async function supplier(active = true) {
  const db = await getReadyDb(), name = "删除供应商回归" + randomUUID();
  const row = await db.supplier.create({ data: { name, normalizedName: normalizeName(name), contactName: "测试联系人", contactPhone: "fixture-phone", active } });
  ids.push(row.id); return row;
}
afterEach(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { id: { in: documents } } });
  await db.contract.deleteMany({ where: { id: { in: contracts } } });
  await db.auditLog.deleteMany({ where: { entityType: "supplier", entityId: { in: ids } } });
  await db.supplier.deleteMany({ where: { id: { in: ids } } });
  ids.length = documents.length = contracts.length = 0;
});

describe("供应商删除及业务保护", () => {
  it("普通员工和财务不能删除供应商", async () => {
    const row = await supplier();
    for (const globalRole of ["STAFF", "FINANCE"] as const) await expect(deleteSupplier({ ...admin, globalRole }, row.id, row.updatedAt.toISOString())).rejects.toMatchObject({ status: 403 });
    expect(await (await getReadyDb()).supplier.findUnique({ where: { id: row.id } })).not.toBeNull();
  });
  it("已有全公司基础资料维护授权可删除未使用供应商", async () => {
    const row = await supplier();
    const manager: SessionUser = { ...admin, globalRole: "STAFF", memberships: [{ projectId: "fixture", projectName: "测试", projectCode: "TEST", roles: [], permissions: ["master.manage"] }] };
    await expect(deleteSupplier(manager, row.id, row.updatedAt.toISOString())).resolves.toEqual({ deleted: true });
  });
  it("删除未使用的停用供应商及别名，保留其他供应商、员工和材料，并记录审计", async () => {
    const db = await getReadyDb(), row = await supplier(false), other = await supplier();
    await db.supplierAlias.create({ data: { supplierId: row.id, alias: "别名" + row.id, normalizedAlias: "alias" + row.id } });
    const [users, ingredients, projects] = await Promise.all([db.user.findMany(), db.ingredient.findMany(), db.project.findMany()]);
    await deleteSupplier(admin, row.id, row.updatedAt.toISOString());
    expect(await db.supplier.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await db.supplierAlias.count({ where: { supplierId: row.id } })).toBe(0);
    expect(await db.supplier.findUnique({ where: { id: other.id } })).toEqual(other);
    expect(await Promise.all([db.user.findMany(), db.ingredient.findMany(), db.project.findMany()])).toEqual([users, ingredients, projects]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: row.id, action: "supplier.deleted" } });
    expect(audit.afterValue).toEqual({ deleted: true, removedAliases: 1 });
    expect(JSON.stringify(audit)).not.toContain("fixture-phone");
  });
  it("供应商已更新时拒绝旧版本，保留新内容", async () => {
    const db = await getReadyDb(), row = await supplier();
    await db.supplier.update({ where: { id: row.id }, data: { contactName: "新联系人", updatedAt: new Date(row.updatedAt.getTime() + 1) } });
    await expect(deleteSupplier(admin, row.id, row.updatedAt.toISOString())).rejects.toMatchObject({ status: 409 });
    expect(await db.supplier.findUnique({ where: { id: row.id } })).toMatchObject({ contactName: "新联系人" });
  });
  it("有草稿单据也拒绝删除，供应商关联和单据保持原样", async () => {
    const db = await getReadyDb(), row = await supplier(), project = await db.project.findFirstOrThrow();
    const document = await db.document.create({ data: { projectId: project.id, supplierId: row.id, createdById: admin.id, docDate: new Date("2026-11-19"), status: "DRAFT" } });documents.push(document.id);
    await expect(deleteSupplier(admin, row.id, row.updatedAt.toISOString())).rejects.toMatchObject({ status: 409 });
    expect(await db.document.findUnique({ where: { id: document.id } })).toEqual(document);
    expect(await db.supplier.findUnique({ where: { id: row.id } })).not.toBeNull();
  });
  it("有合同价时拒绝，不能利用供应商删除级联清空合同", async () => {
    const db = await getReadyDb(), row = await supplier(), project = await db.project.findFirstOrThrow(), ingredient = await db.ingredient.findFirstOrThrow();
    const contract = await db.contract.create({ data: { projectId: project.id, supplierId: row.id, ingredientId: ingredient.id, unit: ingredient.unit, unitPrice: 5, startsOn: new Date("2026-11-19") } });contracts.push(contract.id);
    await expect(deleteSupplier(admin, row.id, row.updatedAt.toISOString())).rejects.toMatchObject({ status: 409 });
    expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
  });
  it("重新新建同名供应商属于新资料，不能恢复原ID", async () => {
    const db = await getReadyDb(), row = await supplier();
    await deleteSupplier(admin, row.id, row.updatedAt.toISOString());
    const replacement = await db.supplier.create({ data: { name: row.name, normalizedName: row.normalizedName } });ids.push(replacement.id);
    expect(replacement.id).not.toBe(row.id);
    await expect(deleteSupplier(admin, row.id, row.updatedAt.toISOString())).rejects.toMatchObject({ status: 404 });
  });
  it("DELETE接口校验登录、来源、版本参数及异步路由参数", async () => {
    const row = await supplier(), token = await createSessionToken(admin.id);
    const request = (body: unknown, origin = "http://localhost:3000", signed = true) => new NextRequest(`http://localhost:3000/api/master-data/suppliers/${row.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", Origin: origin, ...(signed ? { Cookie: `delivery_session=${token}` } : {}) }, body: JSON.stringify(body) });
    const context = { params: Promise.resolve({ id: row.id }) }, body = { updatedAt: row.updatedAt.toISOString() };
    expect((await DELETE(request(body, undefined, false), context)).status).toBe(401);
    expect((await DELETE(request(body, "https://external.example"), context)).status).toBe(403);
    expect((await DELETE(request({}), context)).status).toBe(400);
    expect((await DELETE(request(body), context)).status).toBe(200);
  });
});
