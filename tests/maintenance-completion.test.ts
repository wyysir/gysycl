import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { createSessionToken, type SessionUser } from "@/server/auth";
import { updateSupplier, updateProject, updateContract } from "@/server/master-maintenance";
import { normalizeName, parseDateOnly } from "@/lib/text";
import { validateMemberships } from "@/server/memberships";
import { POST as createDocument } from "@/app/api/documents/route";
import { PATCH as supplierPatch } from "@/app/api/master-data/suppliers/[id]/route";
import { PATCH as projectPatch } from "@/app/api/projects/[id]/route";
import { PATCH as contractPatch } from "@/app/api/contracts/[id]/route";
import { POST as createContract } from "@/app/api/contracts/route";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const finance: SessionUser = { ...admin, globalRole: "FINANCE" };
const marker = "完成维护" + randomUUID().slice(0, 8);
let projectId = "", secondProject = "", supplierId = "", ingredientId = "", contractId = "", docId = "", token = "";
const request = (path: string, body: unknown, origin = "http://localhost:3000", method = "PATCH") => new NextRequest("http://localhost:3000" + path, {
  method, headers: { Cookie: `delivery_session=${token}`, "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
});
beforeAll(async () => {
  const db = await getReadyDb();
  token = await createSessionToken(admin.id);
  projectId = (await db.project.create({ data: { code: marker, name: marker, region: "测试" } })).id;
  secondProject = (await db.project.create({ data: { code: marker + "2", name: marker + "2" } })).id;
  supplierId = (await db.supplier.create({ data: { name: marker, normalizedName: normalizeName(marker), contactName: "原联系人" } })).id;
  ingredientId = (await db.ingredient.create({ data: { name: marker, normalizedName: normalizeName(marker), spec: "袋装", normalizedSpec: "袋装", unit: "斤" } })).id;
  contractId = (await db.contract.create({ data: { projectId, supplierId, ingredientId, spec: "袋装", unit: "斤", unitPrice: 5, startsOn: new Date("2026-01-01") } })).id;
  docId = (await db.document.create({ data: { docNo: marker, projectId, supplierId, createdById: admin.id, docDate: new Date("2026-01-02"), status: "APPROVED", totalAmount: 10, items: { create: { lineNo: 1, name: "原始品名", rawName: "原始品名", spec: "原规格", unit: "斤", quantity: 2, unitPrice: 5, amount: 10, ingredientId } } } })).id;
});
afterAll(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { id: docId } });
  await db.contract.deleteMany({ where: { projectId: { in: [projectId, secondProject] } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [projectId, secondProject, supplierId, ingredientId, contractId, docId] } } });
  await db.supplier.deleteMany({ where: { id: supplierId } });
  await db.ingredient.deleteMany({ where: { id: ingredientId } });
  await db.project.deleteMany({ where: { id: { in: [projectId, secondProject] } } });
});
describe("完整维护接口与历史保护", () => {
  it("供应商可改名、联系人、别名及启停，旧版本与重复名称被拒绝", async () => {
    const db = await getReadyDb(), row = await db.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    const body = { updatedAt: row.updatedAt.toISOString(), name: marker + "改名", contactName: "新联系人", contactPhone: "123456", aliases: [marker + "别名"], active: false };
    await expect(updateSupplier(finance, supplierId, body)).rejects.toMatchObject({ status: 403 });
    await updateSupplier(admin, supplierId, body);
    expect(await db.supplier.findUnique({ where: { id: supplierId }, include: { aliases: true } })).toMatchObject({ name: body.name, contactName: body.contactName, active: false, aliases: expect.arrayContaining([expect.objectContaining({ alias: marker })]) });
    await expect(updateSupplier(admin, supplierId, body)).rejects.toMatchObject({ status: 409 });
    const current = await db.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    const other = await db.supplier.findFirstOrThrow({ where: { id: { not: supplierId } } });
    await expect(updateSupplier(admin, supplierId, { ...body, updatedAt: current.updatedAt.toISOString(), name: other.name })).rejects.toMatchObject({ status: 409 });
    await updateSupplier(admin, supplierId, { ...body, updatedAt: current.updatedAt.toISOString(), active: true });
  });
  it("合同价可编辑价格和日期，项目双方权限、日期、重复和旧版本均有保护", async () => {
    const db = await getReadyDb(), row = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
    const body = { updatedAt: row.updatedAt.toISOString(), projectId, supplierId, ingredientId, unitPrice: 7.1234, startsOn: "2026-01-03", endsOn: "2026-12-31" };
    await expect(updateContract(finance, contractId, body)).rejects.toMatchObject({ status: 403 });
    await expect(updateContract(admin, contractId, { ...body, endsOn: "2025-01-01" })).rejects.toMatchObject({ status: 400 });
    await updateContract(admin, contractId, body);
    const updated = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(Number(updated.unitPrice)).toBe(7.1234); expect(updated.unit).toBe("斤");
    await expect(updateContract(admin, contractId, body)).rejects.toMatchObject({ status: 409 });
    const restricted: SessionUser = { ...admin, globalRole: "STAFF", memberships: [{ projectId, projectName: marker, projectCode: marker, roles: [], permissions: ["contract.manage", "contract.view_price"] }] };
    await expect(updateContract(restricted, contractId, { ...body, updatedAt: updated.updatedAt.toISOString(), projectId: secondProject })).rejects.toMatchObject({ status: 403 });
    const duplicate = await db.contract.create({ data: { projectId, supplierId, ingredientId, spec: "袋装", unit: "斤", unitPrice: 4, startsOn: parseDateOnly("2026-01-04")! } });
    await expect(updateContract(admin, contractId, { ...body, updatedAt: updated.updatedAt.toISOString(), startsOn: "2026-01-04" })).rejects.toMatchObject({ status: 409 });
    await db.contract.delete({ where: { id: duplicate.id } });
  });
  it("项目可改名和启停，停用阻止新建业务，保留原角色与历史快照", async () => {
    const db = await getReadyDb(), row = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const before = await db.document.findUniqueOrThrow({ where: { id: docId }, include: { items: true } });
    const body = { updatedAt: row.updatedAt.toISOString(), name: marker + "改项目", region: "新区域", active: false };
    await expect(updateProject(finance, projectId, body)).rejects.toMatchObject({ status: 403 });
    await updateProject(admin, projectId, body);
    await expect(updateProject(admin, projectId, body)).rejects.toMatchObject({ status: 409 });
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).code).toBe(marker);
    const response = await createDocument(request("/api/documents", { entryMode: "MANUAL", projectId, docDate: "2026-11-07" }, undefined, "POST"));
    expect(response.status).toBe(400);
    const contractResponse = await createContract(request("/api/contracts", { projectId, supplierId, ingredientId, unit: "斤", spec: "袋装", unitPrice: 5, startsOn: "2026-11-07" }, undefined, "POST"));
    expect(contractResponse.status).toBe(400);
    const membership = { projectId, role: "SUBMITTER" as const };
    await expect(validateMemberships(db, "STAFF", [membership], [membership])).resolves.toBeUndefined();
    await expect(validateMemberships(db, "STAFF", [membership])).rejects.toMatchObject({ status: 400 });
    expect(await db.document.findUniqueOrThrow({ where: { id: docId }, include: { items: true } })).toEqual(before);
    const current = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    await updateProject(admin, projectId, { ...body, updatedAt: current.updatedAt.toISOString(), active: true });
  });
  it("新增PATCH接口验证来源和参数，所有修改有审计", async () => {
    for (const [route, path, id] of [[supplierPatch, "/api/master-data/suppliers/", supplierId], [projectPatch, "/api/projects/", projectId], [contractPatch, "/api/contracts/", contractId]] as const) {
      expect((await route(request(path + id, {}, "https://foreign.invalid"), { params: Promise.resolve({ id }) })).status).toBe(403);
      expect((await route(request(path + id, {}), { params: Promise.resolve({ id }) })).status).toBe(400);
    }
    expect(await (await getReadyDb()).auditLog.count({ where: { entityId: { in: [supplierId, projectId, contractId] } } })).toBeGreaterThanOrEqual(5);
  });
});
