import { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { normalizeName, normalizeSpecification } from "@/lib/text";
import { standardUnitRatio, simpleSpecificationQuantity } from "@/lib/measurement-units";
import { configureMeasurement, freezeDocumentMeasurements, listMeasurements, measurementSchema } from "@/server/measurements";
import { aggregateMaterialPurchases } from "@/server/measurement-analysis";
import { createSessionToken, type SessionUser } from "@/server/auth";
import { PATCH } from "@/app/api/master-data/ingredients/[id]/measurement/route";
import { getIngredient, updateIngredient } from "@/server/ingredients";
import { reviewDocument } from "@/server/document-service";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const ingredientIds: string[] = [], documentIds: string[] = [], materialNames: string[] = [];
const marker = "换算回归" + randomUUID();
async function row(spec = "500ml", unit = "瓶") {
  const db = await getReadyDb(), name = marker + randomUUID();
  const item = await db.ingredient.create({ data: { name, normalizedName: normalizeName(name), spec, normalizedSpec: normalizeSpecification(spec), unit } });
  ingredientIds.push(item.id); return item;
}
function input(version: number, name: string, extra: Record<string, unknown> = {}) {
  if (!materialNames.includes(name)) materialNames.push(name);
  return measurementSchema.parse({ version, materialName: name, productName: "同款酱油", materialUnit: "l", productBaseUnit: "瓶", productBaseQuantity: 0.5, unitQuantity: 1, ...extra });
}
async function purchase(ingredientId: string, quantity: number, amount: number, projectId = "prj_sh") {
  const db = await getReadyDb(), item = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const doc = await db.document.create({ data: { projectId, createdById: admin.id, docDate: new Date(), status: "APPROVED", items: { create: { name: item.name, spec: item.spec, unit: item.unit, quantity, unitPrice: amount / quantity, amount, lineNo: 1, ingredientId } } } });
  documentIds.push(doc.id); await db.$transaction(tx => freezeDocumentMeasurements(tx, doc.id)); return doc;
}
async function analysis(user = admin) {
  const docs = await (await getReadyDb()).document.findMany({ where: { id: { in: documentIds } }, include: { items: true, project: true } });
  return aggregateMaterialPurchases(user, docs);
}
afterEach(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { id: { in: documentIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: ingredientIds } } });
  await db.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
  const materials = await db.materialIdentity.findMany({ where: { name: { in: materialNames } }, select: { id: true } });
  await db.productSpecification.deleteMany({ where: { materialId: { in: materials.map(m => m.id) } } });
  await db.materialIdentity.deleteMany({ where: { id: { in: materials.map(m => m.id) } } });
  ingredientIds.splice(0); documentIds.splice(0); materialNames.splice(0);
});

describe("原材料、商品规格与采购单位分别管理", () => {
  it("同一统计原材料下不同商品名称即使同为500ml也保留各自商品规格", async () => {
    const a=await row(), b=await row(), name=marker+"不同商品";
    const x=await configureMeasurement(admin,a.id,input(a.version,name,{productName:"甲牌酱油"}));
    const y=await configureMeasurement(admin,b.id,input(b.version,name,{productName:"乙牌酱油"}));
    expect(x.measurement!.materialId).toBe(y.measurement!.materialId);
    expect(x.measurement!.productId).not.toBe(y.measurement!.productId);
  });
  it("只修改采购单位保留商品规格归属但清空原包装倍率，既有单据快照不变", async () => {
    const a=await row(), name=marker+"修改单位", db=await getReadyDb();
    await configureMeasurement(admin,a.id,input(a.version,name));
    const doc=await purchase(a.id,1,12), before=await db.documentItem.findFirstOrThrow({where:{documentId:doc.id}});
    const detail=(await getIngredient(admin,a.id)).ingredient;
    const updated=await updateIngredient(admin,a.id,{...detail,unit:"箱"});
    expect(updated.ingredient.measurement).toMatchObject({productId:detail.measurement!.productId,unitQuantity:null});
    expect(updated.ingredient.spec).toBe("500ml");
    expect(await db.documentItem.findUnique({where:{id:before.id}})).toEqual(before);
  });
  it("审核通过在同一事务保存换算快照，缺失的历史换算可由管理员明确补齐", async () => {
    const a=await row(), name=marker+"真实审核", db=await getReadyDb();
    const configured=await configureMeasurement(admin,a.id,input(a.version,name,{unitQuantity:1}));
    const doc=await purchase(a.id,2,24);
    await db.documentItem.updateMany({where:{documentId:doc.id},data:{measurementSnapshot:Prisma.DbNull}});
    await db.document.update({where:{id:doc.id},data:{status:"PENDING_REVIEW"}});
    await reviewDocument(admin,doc.id,{action:"approve",override:true,note:"隔离测试核验审核快照"});
    const frozen=await db.documentItem.findFirstOrThrow({where:{documentId:doc.id}});
    expect(frozen.measurementSnapshot).toMatchObject({productBaseQuantity:"0.5",unitQuantity:"1"});
    await configureMeasurement(admin,a.id,input(configured.version,name,{productVersion:configured.measurement!.productVersion}));
    expect((await db.documentItem.findUniqueOrThrow({where:{id:frozen.id}})).measurementSnapshot).toEqual(frozen.measurementSnapshot);
  });
  it("同款500ml按瓶和箱采购共用商品规格，不同1l规格仍归同一种原材料", async () => {
    const a = await row(), b = await row("500ml", "箱"), c = await row("1l"), name = marker + "酱油";
    const first = await configureMeasurement(admin, a.id, input(a.version, name));
    const second = await configureMeasurement(admin, b.id, input(b.version, name, { unitQuantity: 12 }));
    const third = await configureMeasurement(admin, c.id, input(c.version, name, { productBaseQuantity: 1 }));
    expect(first.measurement?.productId).toBe(second.measurement?.productId);
    expect(third.measurement?.productId).not.toBe(first.measurement?.productId);
    await purchase(a.id, 1, 12); await purchase(b.id, 1, 120); await purchase(c.id, 2, 40);
    const groups = await analysis(); expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ configured: true, specificationCount: 2, quantity: 8.5, amount: 172, averagePrice: 20.2353, pending: 0 });
    expect(groups[0].variants).toHaveLength(3);
    expect((await listMeasurements(admin)).materials.find(m => m.name === name)?.products).toHaveLength(2);
  });
  it("箱规未知保留总额和原数量，不把未换算数量当0，也不算混合均价", async () => {
    const a = await row(), b = await row("500ml", "箱"), name = marker + "未知箱规";
    await configureMeasurement(admin, a.id, input(a.version, name));
    await configureMeasurement(admin, b.id, input(b.version, name, { unitQuantity: null }));
    await purchase(a.id, 1, 12); await purchase(b.id, 1, 120);
    expect((await analysis())[0]).toMatchObject({ amount: 132, quantity: null, averagePrice: null, pending: 1 });
    expect((await analysis())[0].originalQuantities).toEqual(expect.arrayContaining([{ unit: "瓶", quantity: 1 }, { unit: "箱", quantity: 1 }]));
  });
  it("后续箱规12改6只用于新确认单据，不静默改写旧单据", async () => {
    const a = await row("500ml", "箱"), name = marker + "历史箱规";
    const configured = await configureMeasurement(admin, a.id, input(a.version, name, { unitQuantity: 12 }));
    const old = await purchase(a.id, 1, 120), db = await getReadyDb();
    const oldItems = await db.documentItem.findMany({ where: { documentId: old.id } });
    await configureMeasurement(admin, a.id, input(configured.version, name, { unitQuantity: 6, productVersion: configured.measurement!.productVersion, applyToHistory: true }));
    expect(await db.documentItem.findMany({ where: { documentId: old.id } })).toEqual(oldItems);
    await purchase(a.id, 1, 66);
    expect((await analysis())[0]).toMatchObject({ quantity: 9, amount: 186, averagePrice: 20.6667 });
  });
  it("已审历史默认不变，明确确认后仅补齐尚未确认换算的明细", async () => {
    const a = await row(), name = marker + "历史确认", db = await getReadyDb();
    const doc = await purchase(a.id, 2, 24);
    const before = await db.documentItem.findFirstOrThrow({ where: { documentId: doc.id } });
    const configured = await configureMeasurement(admin, a.id, input(a.version, name));
    expect(await db.documentItem.findUnique({ where: { id: before.id } })).toEqual(before);
    expect((await analysis())[0]).toMatchObject({ configured: false, quantity: null });
    const applied = await configureMeasurement(admin, a.id, input(configured.version, name, { productVersion: configured.measurement!.productVersion, applyToHistory: true }));
    expect(applied.historicalItemsApplied).toBe(1);
    const after = await db.documentItem.findUniqueOrThrow({ where: { id: before.id } });
    expect([after.quantity, after.unitPrice, after.amount, after.spec, after.unit]).toEqual([before.quantity, before.unitPrice, before.amount, before.spec, before.unit]);
    expect((await analysis())[0]).toMatchObject({ configured: true, quantity: 1, amount: 24 });
  });
  it("1.9l和19l是不同商品规格，不能因去掉小数点而共用价格或换算", async () => {
    expect(normalizeSpecification("1.9L")).not.toBe(normalizeSpecification("19L"));
    const a = await row("1.9l"), b = await row("19l"), name = marker + "小数规格";
    const x = await configureMeasurement(admin, a.id, input(a.version, name, { productBaseQuantity: 1.9 }));
    const y = await configureMeasurement(admin, b.id, input(b.version, name, { productBaseQuantity: 19 }));
    expect(x.measurement?.productId).not.toBe(y.measurement?.productId);
    await expect(configureMeasurement(admin, a.id, input(x.version, name, { productBaseQuantity: 19, productVersion: x.measurement!.productVersion }))).rejects.toMatchObject({ status: 400 });
  });
  it("通用单位换算只在同维度内进行，箱瓶关系不能靠猜", () => {
    expect(simpleSpecificationQuantity("410ml", "瓶", "l")).toBe(0.41);
    expect(standardUnitRatio("斤", "kg")).toBe(0.5); expect(standardUnitRatio("毫升", "L")).toBe(0.001);
    expect(standardUnitRatio("瓶", "箱")).toBeNull(); expect(standardUnitRatio("l", "kg")).toBeNull();
  });
  it("版本、权限、来源和规格约束阻止越权或旧配置覆盖", async () => {
    const a = await row(), name = marker + "权限";
    await expect(configureMeasurement({ ...admin, globalRole: "FINANCE" }, a.id, input(a.version, name))).rejects.toMatchObject({ status: 403 });
    const current = await configureMeasurement(admin, a.id, input(a.version, name));
    await expect(configureMeasurement(admin, a.id, input(a.version, name))).rejects.toMatchObject({ status: 409 });
    await expect(configureMeasurement(admin, a.id, input(current.version, name, { unitQuantity: 12 }))).rejects.toMatchObject({ status: 400 });
    const token = await createSessionToken(admin.id), make = (origin: string, cookie = true) => new NextRequest("http://localhost:3000/api/master-data/ingredients/" + a.id + "/measurement", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: `delivery_session=${token}` } : {}) }, body: JSON.stringify(input(current.version, name)) });
    expect((await PATCH(make("https://foreign.example"), { params: Promise.resolve({ id: a.id }) })).status).toBe(403);
    expect((await PATCH(make("http://localhost:3000", false), { params: Promise.resolve({ id: a.id }) })).status).toBe(401);
  });
  it("汇总不能通过有单价无金额权限的角色泄露金额或反推均价", async () => {
    const a = await row(), name = marker + "脱敏"; await configureMeasurement(admin, a.id, input(a.version, name)); await purchase(a.id, 2, 24);
    const user: SessionUser = { ...admin, globalRole: "STAFF", memberships: [{ projectId: "prj_sh", projectCode: "SH", projectName: "上海", roles: [], permissions: ["analytics.view", "document.view_unit_price"] }] };
    expect((await analysis(user))[0]).toMatchObject({ amount: null, averagePrice: null, quantity: 1, amountRestricted: true });
  });
});
