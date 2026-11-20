import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { chooseMaterial } from "@/lib/material-choice";
import { normalizeName, normalizeSpecification } from "@/lib/text";
import { createMaterialCatalogue } from "@/server/material-catalogue";
import { getDocumentDetail, saveDocument, submitDocument, reviewDocument } from "@/server/document-service";
import { configureMeasurement } from "@/server/measurements";
import { aggregateMaterialPurchases } from "@/server/measurement-analysis";
import { listIngredients } from "@/server/ingredients";
import type { SessionUser } from "@/server/auth";

const admin: SessionUser = { id: "usr_admin", name: "测试管理员", employeeNo: "admin", globalRole: "ADMIN", memberships: [] };
const marker = "采购单位回归" + randomUUID(), docs: string[] = [];
async function setup(suffix: string, spec = "", unit = "斤") {
  const db = await getReadyDb(), name = marker + suffix;
  const ingredient = await db.ingredient.create({ data: { name, normalizedName: normalizeName(name), spec, normalizedSpec: normalizeSpecification(spec), unit, notes: "用户指定默认单位待核实" } });
  const doc = await db.document.create({ data: { docNo: marker + suffix, projectId: "prj_sh", supplierId: "sup_sh", createdById: admin.id,
    status: "DRAFT", docDate: new Date("2026-11-20"), subtotal: 20, totalAmount: 20,
    items: { create: { lineNo: 1, name, rawName: name, spec, unit, quantity: 2, unitPrice: 10, amount: 20, confidence: .6, rawOcr: { unit, pageNo: 1, unitConfidence: .3 } } } } });
  docs.push(doc.id); return { db, name, ingredient, doc };
}
async function inputFor(id: string, unit: string, confirmed = true) {
  const d = (await getDocumentDetail(admin, id)).document, item = d.items[0];
  const group = (await createMaterialCatalogue(await getReadyDb())).exact(item.name, item.spec)!;
  const patch = chooseMaterial(item, group, unit);
  if (!confirmed) patch.materialChoice = { ...patch.materialChoice, source: "ocr", confirmedUnit: null };
  return { version: d.version, docDate: d.docDate, projectId: d.projectId, supplierId: d.supplierId,
    totalAmount: 20, items: [{ ...item, ...patch }] };
}
afterAll(async () => {
  const db = await getReadyDb(); await db.document.deleteMany({ where: { id: { in: docs } } });
  await db.ingredient.deleteMany({ where: { name: { startsWith: marker } } });
  await db.productSpecification.deleteMany({ where: { name: { startsWith: marker } } });
  await db.materialIdentity.deleteMany({ where: { name: { startsWith: marker } } });
});
describe("单据保存时登记真实采购单位", () => {
  it("adds a unit to the same product, preserves numbers/provenance, and permits normal approval without a conversion", async () => {
    const { db, ingredient, doc } = await setup("鸽子");
    const saved = (await saveDocument(admin, doc.id, await inputFor(doc.id, "只"))).document, row = saved.items[0];
    expect(row).toMatchObject({ unit: "只", quantity: 2, unitPrice: 10, amount: 20, confidence: .6, originalUnit: "斤" });
    expect(row.ingredientId).not.toBe(ingredient.id); expect(row.materialChoice).toMatchObject({ source: "manual", confirmedUnit: "只", provisional: false });
    const old = await db.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }), fresh = await db.ingredient.findUniqueOrThrow({ where: { id: row.ingredientId! } });
    expect(old.unit).toBe("斤"); expect(old.notes).toContain("用户指定默认"); expect(old.productSpecificationId).toBe(fresh.productSpecificationId); expect(fresh.quantityPerProductUnit).toBeNull();
    expect(saved.checks.some(c => ["unit_mismatch", "ingredient_unmatched"].includes(c.type))).toBe(false);
    expect(saved.checks).toContainEqual(expect.objectContaining({ type: "unit_conversion_pending", severity: "WARNING" }));
    expect(await db.ingredientAlias.count({ where: { ingredientId: fresh.id } })).toBe(0);
    await submitDocument(admin, doc.id); await reviewDocument(admin, doc.id, { action: "approve" });
    const closed = await db.document.findUniqueOrThrow({ where: { id: doc.id }, include: { items: true, project: true } });
    expect(closed.status).toBe("APPROVED"); const result = aggregateMaterialPurchases(admin, [closed]);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ amount: 20, quantity: null, averagePrice: null, pending: 1 });
  });
  it("reuses the existing unit on repeat saves and multiple lines rather than creating duplicates", async () => {
    const { db, name, doc } = await setup("重复"); const input = await inputFor(doc.id, "箱"); input.items.push({ ...input.items[0], id: "new-row", lineNo: 2 }); input.totalAmount = 40;
    const saved = (await saveDocument(admin, doc.id, input)).document;
    expect(saved.items[0].ingredientId).toBe(saved.items[1].ingredientId);
    await saveDocument(admin, doc.id, { ...input, version: saved.version, items: saved.items });
    expect(await db.ingredient.count({ where: { name, unit: "箱" } })).toBe(1);
    expect(await db.auditLog.count({ where: { documentId: doc.id, action: "ingredient.unit_registered_from_document" } })).toBe(1);
  });
  it("never creates a unit from unconfirmed OCR or from recheck", async () => {
    const { db, name, doc } = await setup("识别");
    const saved = (await saveDocument(admin, doc.id, await inputFor(doc.id, "包", false))).document;
    expect(saved.items[0].ingredientId).toBeNull(); expect(await db.ingredient.count({ where: { name } })).toBe(1);
  });
  it("checks project-scoped create permissions and keeps a failed save atomic", async () => {
    const { db, name, doc } = await setup("权限"); const input = await inputFor(doc.id, "只");
    const staff: SessionUser = { ...admin, globalRole: "STAFF", memberships: [{ projectId: "prj_sh", projectName: "测试项目", projectCode: "SH", roles: [], permissions: ["document.edit_own"] }] };
    await expect(saveDocument(staff, doc.id, input)).rejects.toMatchObject({ status: 403 });
    expect(await db.ingredient.count({ where: { name } })).toBe(1); expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).version).toBe(input.version);
    await expect(saveDocument(admin, doc.id, { ...input, version: input.version + 1 })).rejects.toMatchObject({ status: 409 });
    expect(await db.ingredient.count({ where: { name } })).toBe(1);
  });
  it("does not reactivate a stopped unit or create another specification from a stale selection", async () => {
    const { db, name, doc } = await setup("停用", "500ml", "瓶");
    await db.ingredient.create({ data: { name, normalizedName: normalizeName(name), spec: "500ml", normalizedSpec: "500ml", unit: "箱", active: false } });
    const input = await inputFor(doc.id, "箱"); await expect(saveDocument(admin, doc.id, input)).rejects.toThrow("已停用");
    expect(await db.ingredient.count({ where: { name } })).toBe(2);
    await expect(saveDocument(admin, doc.id, { ...input, items: [{ ...input.items[0], spec: "1.9l" }] })).rejects.toThrow("重新检索");
    expect(await db.ingredient.count({ where: { name, spec: "1.9l" } })).toBe(0);
  });
  it("rolls back earlier registrations and grouping if a later unit in the same save is invalid", async () => {
    const first = await setup("事务甲"), second = await setup("事务乙");
    const input = await inputFor(first.doc.id, "只"), bad = await inputFor(second.doc.id, "500g");
    input.items.push({ ...bad.items[0], id: "new-row", lineNo: 2 }); input.totalAmount = 40;
    await expect(saveDocument(admin, first.doc.id, input)).rejects.toThrow("请只填写采购单位");
    const separated = await inputFor(second.doc.id, "箱/件"); input.items[1] = { ...separated.items[0], id: "new-row", lineNo: 2 };
    await expect(saveDocument(admin, first.doc.id, input)).rejects.toThrow("请只填写采购单位");
    expect(await first.db.ingredient.count({ where: { name: first.name } })).toBe(1);
    expect((await first.db.ingredient.findUniqueOrThrow({ where: { id: first.ingredient.id } })).productSpecificationId).toBeNull();
    expect(await first.db.materialIdentity.count({ where: { name: first.name } })).toBe(0);
  });
  it("shares a configured product but never copies bottle conversion to a new box, and only explicitly updates pending history", async () => {
    const { db, ingredient, doc, name } = await setup("酱油", "500ml", "瓶");
    await configureMeasurement(admin, ingredient.id, { version: 1, materialName: name, productName: name, materialUnit: "l", productBaseUnit: "瓶", productBaseQuantity: .5, unitQuantity: 1, applyToHistory: false });
    const saved = (await saveDocument(admin, doc.id, await inputFor(doc.id, "箱"))).document, id = saved.items[0].ingredientId!;
    const bottle = await db.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }), box = await db.ingredient.findUniqueOrThrow({ where: { id } });
    expect(box.productSpecificationId).toBe(bottle.productSpecificationId); expect(box.quantityPerProductUnit).toBeNull(); expect(Number(bottle.quantityPerProductUnit)).toBe(1);
    await submitDocument(admin, doc.id); await reviewDocument(admin, doc.id, { action: "approve" });
    const before = await db.documentItem.findFirstOrThrow({ where: { documentId: doc.id } });
    const config = { version: box.version, materialName: name, productName: name, materialUnit: "l", productBaseUnit: "瓶", productBaseQuantity: .5, unitQuantity: 12, productVersion: 1, applyToHistory: false };
    const changed = await configureMeasurement(admin, id, config);
    expect((await db.documentItem.findUniqueOrThrow({ where: { id: before.id } })).measurementSnapshot).toEqual(before.measurementSnapshot);
    await configureMeasurement(admin, id, { ...config, version: changed.version, applyToHistory: true });
    const closed = await db.document.findUniqueOrThrow({ where: { id: doc.id }, include: { items: true, project: true } });
    expect(aggregateMaterialPurchases(admin, [closed])[0]).toMatchObject({ amount: 20, quantity: 12, averagePrice: 1.6667, pending: 0 });
    expect(closed.items[0]).toMatchObject({ unit: "箱" }); expect(Number(closed.items[0].quantity)).toBe(2);
  });
  it("finds same-name same-spec multiple units and pending conversions without mixing different specs", async () => {
    const { name, doc } = await setup("后台筛选", "500ml", "瓶");
    await saveDocument(admin, doc.id, await inputFor(doc.id, "箱"));
    const multi = await listIngredients(admin, { q: name, unitScope: "multi" }); expect(multi.total).toBe(2);
    expect((await listIngredients(admin, { q: name, unitScope: "multi_pending" })).total).toBe(2);
    const separate = await setup("不同规格", "500ml", "瓶");
    await separate.db.ingredient.create({ data: { name: separate.name, normalizedName: normalizeName(separate.name), spec: "1.9l", normalizedSpec: "1.9l", unit: "箱" } });
    expect((await listIngredients(admin, { q: separate.name, unitScope: "multi" })).total).toBe(0);
  });
  it("concurrent documents adding the same unit share one record", async () => {
    const { db, name, doc } = await setup("并发");
    const another = await db.document.create({ data: { docNo: marker + "并发乙", projectId: "prj_sh", supplierId: "sup_sh", createdById: admin.id,
      docDate: new Date("2026-11-20"), subtotal: 20, totalAmount: 20, status: "DRAFT", items: { create: { lineNo: 1, name, rawName: name, unit: "只", quantity: 2, unitPrice: 10, amount: 20, confidence: .6 } } } });
    docs.push(another.id); const [a, b] = await Promise.all([inputFor(doc.id, "只"), inputFor(another.id, "只")]);
    const results = await Promise.all([saveDocument(admin, doc.id, a), saveDocument(admin, another.id, b)]);
    expect(results[0].document.items[0].ingredientId).toBe(results[1].document.items[0].ingredientId);
    expect(await db.ingredient.count({ where: { name, unit: "只" } })).toBe(1);
  });
  it("retains an explicitly confirmed rounding adjustment when registering its purchase unit", async () => {
    const { doc } = await setup("抹零"), input = await inputFor(doc.id, "只");
    input.totalAmount = 19.5; input.items[0] = { ...input.items[0], amount: 19.5, roundingConfirmed: true };
    const saved = (await saveDocument(admin, doc.id, input)).document;
    expect(saved.items[0]).toMatchObject({ unit: "只", quantity: 2, unitPrice: 10, amount: 19.5, roundingConfirmed: true });
    expect(saved.checks.some(c => c.type === "line_arithmetic")).toBe(false);
  });
  it("adding units does not bypass hidden-price protection", async () => {
    const { db, doc } = await setup("金额权限"), input = await inputFor(doc.id, "只");
    const staff: SessionUser = { ...admin, globalRole: "STAFF", memberships: [{ projectId: "prj_sh", projectName: "测试项目", projectCode: "SH", roles: [], permissions: ["document.edit_own", "master.create"] }] };
    input.items[0].unitPrice = 1000000; input.items[0].amount = 2000000;
    const saved = (await saveDocument(staff, doc.id, input)).document;
    expect(saved.items[0]).toMatchObject({ unit: "只", unitPrice: null, amount: null });
    const row = await db.documentItem.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(Number(row.unitPrice)).toBe(10); expect(Number(row.amount)).toBe(20);
  });
});
