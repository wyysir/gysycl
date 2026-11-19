import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { normalizeName } from "@/lib/text";
import { createSessionToken, requireUser, type SessionUser } from "@/server/auth";
import { bulkMaintain, type BulkKind } from "@/server/bulk-maintenance";
import { POST as suppliers } from "@/app/api/master-data/suppliers/bulk/route";
import { POST as projects } from "@/app/api/projects/bulk/route";
import { POST as users } from "@/app/api/users/bulk/route";
import { POST as ingredients } from "@/app/api/master-data/ingredients/bulk/route";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const tracked = { supplier: [] as string[], project: [] as string[], user: [] as string[], ingredient: [] as string[] };
const documents: string[] = [], contracts: string[] = [];
const batches: string[] = [];
async function fixture(kind: BulkKind) {
  const db = await getReadyDb(), name = "批量回归" + randomUUID();
  const row = kind === "supplier" ? await db.supplier.create({ data: { name, normalizedName: normalizeName(name) } })
    : kind === "project" ? await db.project.create({ data: { name, code: randomUUID() } })
    : kind === "user" ? await db.user.create({ data: { name, employeeNo: randomUUID(), passwordHash: "isolated-test-only" } })
    : await db.ingredient.create({ data: { name, normalizedName: normalizeName(name), unit: "斤" } });
  tracked[kind].push(row.id); return row;
}
type Row = Awaited<ReturnType<typeof fixture>>;
const item = (row: Row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString(), ...("version" in row ? { version: row.version } : {}) });
async function find(kind: BulkKind, id: string) {
  const db = await getReadyDb();
  return kind === "supplier" ? db.supplier.findUnique({ where: { id } }) : kind === "project" ? db.project.findUnique({ where: { id } }) : kind === "user" ? db.user.findUnique({ where: { id } }) : db.ingredient.findUnique({ where: { id } });
}
afterEach(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { id: { in: documents } } });
  await db.contract.deleteMany({ where: { id: { in: contracts } } });
  await db.uploadBatch.deleteMany({ where: { id: { in: batches } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: Object.values(tracked).flat() } } });
  await db.projectDailyRevenue.deleteMany({ where: { projectId: { in: tracked.project } } });
  await db.user.deleteMany({ where: { id: { in: tracked.user } } });
  await db.project.deleteMany({ where: { id: { in: tracked.project } } });
  await db.supplier.deleteMany({ where: { id: { in: tracked.supplier } } });
  await db.ingredient.deleteMany({ where: { id: { in: tracked.ingredient } } });
  Object.values(tracked).forEach(ids => ids.splice(0)); documents.splice(0); contracts.splice(0); batches.splice(0);
});

describe.each(["supplier", "project", "user", "ingredient"] as const)("%s批量维护", kind => {
  it("批量停用后可重新启用，未选资料不变化且有逐条审计", async () => {
    const a = await fixture(kind), b = await fixture(kind), untouched = await fixture(kind);
    await bulkMaintain(admin, kind, { action: "disable", items: [item(a), item(b)] });
    const stopped = await Promise.all([find(kind, a.id), find(kind, b.id)]);
    expect(stopped.every(row => row?.active === false)).toBe(true);
    await bulkMaintain(admin, kind, { action: "enable", items: stopped.map(row => item(row!)) });
    expect((await find(kind, a.id))?.active).toBe(true);
    expect((await find(kind, b.id))?.active).toBe(true);
    expect(await find(kind, untouched.id)).toEqual(untouched);
    expect(await (await getReadyDb()).auditLog.count({ where: { entityId: { in: [a.id, b.id] }, action: { startsWith: `${kind}.bulk` } } })).toBe(4);
  });
  it("一条版本过期或不存在时，整批资料与审计均不变", async () => {
    const rows = [await fixture(kind), await fixture(kind)].sort((a, b) => a.id.localeCompare(b.id));
    const stale = { ...item(rows[1]), updatedAt: new Date(0).toISOString(), version: 999999 };
    await expect(bulkMaintain(admin, kind, { action: "disable", items: [item(rows[0]), stale] })).rejects.toMatchObject({ status: 409 });
    expect(await find(kind, rows[0].id)).toEqual(rows[0]);
    await expect(bulkMaintain(admin, kind, { action: "delete", items: [item(rows[0]), { ...item(rows[1]), id: "zz-missing" }] })).rejects.toMatchObject({ status: 409 });
    expect(await find(kind, rows[0].id)).toEqual(rows[0]);
    expect(await (await getReadyDb()).auditLog.count({ where: { entityId: { in: rows.map(row => row.id) } } })).toBe(0);
  });
  it("拒绝重复选择、缺少版本和无权限调用", async () => {
    const row = await fixture(kind);
    await expect(bulkMaintain(admin, kind, { action: "delete", items: [item(row), item(row)] })).rejects.toMatchObject({ status: 400 });
    await expect(bulkMaintain(admin, kind, { action: "delete", items: [{ id: row.id }] })).rejects.toMatchObject({ status: 400 });
    for (const globalRole of ["STAFF", "FINANCE"] as const) await expect(bulkMaintain({ ...admin, globalRole }, kind, { action: "delete", items: [item(row)] })).rejects.toMatchObject({ status: 403 });
    expect(await find(kind, row.id)).toEqual(row);
  });
});

it("批量删除员工保留成员归属，旧令牌即时失效，混选自己整批拒绝", async () => {
  const db = await getReadyDb(), a = await fixture("user"), b = await fixture("user"), project = await db.project.findFirstOrThrow();
  const membership = await db.projectMembership.create({ data: { userId: a.id, projectId: project.id, role: "SUBMITTER" } });
  const token = await createSessionToken(a.id), actor = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
  for (const action of ["delete", "disable"] as const) await expect(bulkMaintain(admin, "user", { action, items: [item(a), item(actor)] })).rejects.toMatchObject({ status: 400 });
  expect(await find("user", a.id)).toEqual(a);
  await bulkMaintain(admin, "user", { action: "delete", items: [item(a), item(b)] });
  expect(await find("user", a.id)).toMatchObject({ active: false, deletedAt: expect.any(Date) });
  expect(await db.projectMembership.findUnique({ where: { id: membership.id } })).toEqual(membership);
  await expect(requireUser(new NextRequest("http://localhost:3000/api/bootstrap", { headers: { Cookie: `delivery_session=${token}` } }))).rejects.toMatchObject({ status: 401 });
  await expect(bulkMaintain(admin, "user", { action: "enable", items: [item((await find("user", a.id))!)] })).rejects.toMatchObject({ status: 409 });
});

it.each(["supplier", "project", "ingredient"] as const)("%s的合同关联阻止整批删除，不发生级联业务删除", async kind => {
  const db = await getReadyDb(), rows = [await fixture(kind), await fixture(kind)].sort((a, b) => a.id.localeCompare(b.id));
  const project = await db.project.findFirstOrThrow(), supplier = await db.supplier.findFirstOrThrow(), ingredient = await db.ingredient.findFirstOrThrow();
  const contract = await db.contract.create({ data: { projectId: kind === "project" ? rows[1].id : project.id, supplierId: kind === "supplier" ? rows[1].id : supplier.id, ingredientId: kind === "ingredient" ? rows[1].id : ingredient.id, unit: "斤", unitPrice: 2, startsOn: new Date("2026-11-19") } }); contracts.push(contract.id);
  await expect(bulkMaintain(admin, kind, { action: "delete", items: rows.map(item) })).rejects.toMatchObject({ status: 409 });
  expect(await find(kind, rows[0].id)).toEqual(rows[0]);
  expect(await db.contract.findUnique({ where: { id: contract.id } })).toEqual(contract);
});

it("原材料的草稿明细关联也阻止删除；未使用材料及别名可删除", async () => {
  const db = await getReadyDb(), used = await fixture("ingredient"), unused = await fixture("ingredient"), project = await db.project.findFirstOrThrow();
  const doc = await db.document.create({ data: { projectId: project.id, createdById: admin.id, status: "DRAFT", docDate: new Date(), items: { create: { lineNo: 1, name: used.name, ingredientId: used.id } } } }); documents.push(doc.id);
  await expect(bulkMaintain(admin, "ingredient", { action: "delete", items: [item(unused), item(used)] })).rejects.toMatchObject({ status: 409 });
  await db.ingredientAlias.create({ data: { ingredientId: unused.id, alias: unused.name, normalizedAlias: normalizeName(unused.name) } });
  await bulkMaintain(admin, "ingredient", { action: "delete", items: [item(unused)] });
  expect(await find("ingredient", unused.id)).toBeNull();
  expect(await db.ingredientAlias.count({ where: { ingredientId: unused.id } })).toBe(0);
  expect(await db.document.findUnique({ where: { id: doc.id } })).toEqual(doc);
});

it.each(["supplier", "project"] as const)("%s未使用资料可批量删除，其他资料保留", async kind => {
  const rows = [await fixture(kind), await fixture(kind)], other = await fixture(kind);
  await bulkMaintain(admin, kind, { action: "delete", items: rows.map(item) });
  expect(await find(kind, rows[0].id)).toBeNull(); expect(await find(kind, rows[1].id)).toBeNull();
  expect(await find(kind, other.id)).toEqual(other);
});

it("供应商草稿单据及项目营业额、上传批次均阻止整批删除", async () => {
  const db = await getReadyDb(), supplier = await fixture("supplier"), p = await fixture("project");
  const doc = await db.document.create({ data: { supplierId: supplier.id, projectId: p.id, createdById: admin.id, docDate: new Date(), status: "DRAFT" } }); documents.push(doc.id);
  await expect(bulkMaintain(admin, "supplier", { action: "delete", items: [item(supplier)] })).rejects.toMatchObject({ status: 409 });
  await db.document.delete({ where: { id: doc.id } });
  const batch = await db.uploadBatch.create({ data: { id: randomUUID(), requestId: randomUUID(), docDate: new Date(), projectId: p.id, createdById: admin.id } }); batches.push(batch.id);
  await expect(bulkMaintain(admin, "project", { action: "delete", items: [item(p)] })).rejects.toMatchObject({ status: 409 });
  await db.uploadBatch.delete({ where: { id: batch.id } });
  await db.projectDailyRevenue.create({ data: { projectId: p.id, date: new Date("2026-11-19"), amount: 50, createdById: admin.id, updatedById: admin.id } });
  await expect(bulkMaintain(admin, "project", { action: "delete", items: [item(p)] })).rejects.toMatchObject({ status: 409 });
  expect(await db.projectDailyRevenue.count({ where: { projectId: p.id } })).toBe(1);
});

it("基础资料维护授权允许批量维护，不能借此维护项目或员工", async () => {
  const row = await fixture("supplier"), user: SessionUser = { ...admin, globalRole: "STAFF", memberships: [{ projectId: "fixture", projectCode: "UI", projectName: "测试", roles: [], permissions: ["master.manage"] }] };
  await bulkMaintain(user, "supplier", { action: "disable", items: [item(row)] });
  expect((await find("supplier", row.id))?.active).toBe(false);
  for (const kind of ["project", "user"] as const) await expect(bulkMaintain(user, kind, { action: "delete", items: [item(row)] })).rejects.toMatchObject({ status: 403 });
});

it("员工批量操作在事务内重新核验管理员身份", async () => {
  const row = await fixture("user");
  await expect(bulkMaintain({ ...admin, id: row.id }, "user", { action: "disable", items: [item((await fixture("user")))] })).rejects.toMatchObject({ status: 403 });
  expect(await find("user", row.id)).toEqual(row);
});

it.each([["supplier", suppliers], ["project", projects], ["user", users], ["ingredient", ingredients]] as const)("%s批量接口校验认证、来源与参数", async (kind, route) => {
  const row = await fixture(kind), token = await createSessionToken(admin.id), body = { action: "disable", items: [item(row)] };
  const request = (payload: unknown, origin = "http://localhost:3000", signed = true) => new NextRequest("http://localhost:3000/api/test/bulk", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(signed ? { Cookie: `delivery_session=${token}` } : {}) }, body: JSON.stringify(payload) });
  expect((await route(request(body, undefined, false))).status).toBe(401);
  expect((await route(request(body, "https://foreign.invalid"))).status).toBe(403);
  expect((await route(request({ action: "delete", items: [] }))).status).toBe(400);
  expect((await route(request({ ...body, items: Array(201).fill(item(row)) }))).status).toBe(400);
  expect((await route(request(body))).status).toBe(200);
});
