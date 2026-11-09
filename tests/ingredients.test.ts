import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getReadyDb } from "@/lib/bootstrap";
import {
  getIngredient,
  ingredientHistory,
  listIngredients,
  updateIngredient,
} from "@/server/ingredients";
import {
  createIngredientFromDocument,
  mergeMasterData,
} from "@/server/master-commands";
import { saveDocument } from "@/server/document-service";
import { buildMasterTemplate, importMasterWorkbook } from "@/server/excel";
import { normalizeName } from "@/lib/text";
import type { SessionUser } from "@/server/auth";

const admin: SessionUser = {
  id: "usr_admin",
  employeeNo: "admin",
  name: "管理员",
  globalRole: "ADMIN",
  memberships: [],
};
const staff: SessionUser = {
  id: "usr_site_sh",
  employeeNo: "site_sh",
  name: "采购",
  globalRole: "STAFF",
  memberships: [
    {
      projectId: "prj_sh",
      projectName: "上海",
      projectCode: "SH-HQ",
      roles: ["SUBMITTER"],
    },
  ],
};
const finance: SessionUser = { ...admin, globalRole: "FINANCE" };
const ingredientIds: string[] = [],
  documentIds: string[] = [],
  contractIds: string[] = [];
beforeAll(async () => {
  await getReadyDb();
});
afterAll(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { id: { in: documentIds } } });
  await db.contract.deleteMany({ where: { id: { in: contractIds } } });
  await db.auditLog.deleteMany({
    where: { entityType: "ingredient", entityId: { in: ingredientIds } },
  });
  await db.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
});
async function material(unit = "斤", extra: Record<string, unknown> = {}) {
  const db = await getReadyDb(),
    name = "维护测试" + randomUUID();
  const item = await db.ingredient.create({
    data: {
      name,
      normalizedName: normalizeName(name),
      unit,
      spec: unit,
      normalizedSpec: normalizeName(unit),
      ...extra,
    },
  });
  ingredientIds.push(item.id);
  return (await getIngredient(admin, item.id)).ingredient;
}
async function purchase(
  ingredientId: string,
  projectId = "prj_sh",
  status: "APPROVED" | "DRAFT" = "APPROVED",
  unit = "斤",
) {
  const db = await getReadyDb();
  const doc = await db.document.create({
    data: {
      docNo: randomUUID(),
      docDate: new Date("2026-10-25T00:00:00+08:00"),
      createdById: staff.id,
      projectId,
      supplierId: "sup_sh",
      status,
      subtotal: 20,
      totalAmount: 20,
      items: {
        create: {
          lineNo: 1,
          name: "原单品名",
          rawName: "原始识别",
          spec: unit,
          unit,
          quantity: 5,
          unitPrice: 4,
          amount: 20,
          confidence: 0.86,
          ingredientId,
          matchStatus: "MATCHED",
        },
      },
    },
    include: { items: true },
  });
  documentIds.push(doc.id);
  return doc;
}
async function contract(ingredientId: string, projectId = "prj_sh") {
  const db = await getReadyDb();
  const value = await db.contract.create({
    data: {
      projectId,
      supplierId: "sup_sh",
      ingredientId,
      spec: "斤",
      unit: "斤",
      unitPrice: 4,
      startsOn: new Date("2026-01-01"),
      createdById: admin.id,
    },
  });
  contractIds.push(value.id);
  return value;
}
describe("ingredient maintenance and history safety", () => {
  it("edits metadata, deduplicates aliases, searches aliases and retains a legacy spec", async () => {
    const item = await material("斤", {
      spec: "散装",
      normalizedSpec: normalizeName("散装"),
    });
    const result = await updateIngredient(admin, item.id, {
      ...item,
      aliases: ["维护别名" + item.id, "维护别名" + item.id],
      category: "试用分类",
      notes: "只改资料",
      active: true,
    });
    expect(result.ingredient).toMatchObject({
      notes: "只改资料",
      version: 2,
      spec: "散装",
      legacySpec: true,
      aliases: ["维护别名" + item.id],
    });
    expect(
      (await listIngredients(admin, { q: "维护别名" + item.id })).items.map(
        (v) => v.id,
      ),
    ).toContain(item.id);
    expect(
      await (
        await getReadyDb()
      ).auditLog.count({
        where: { entityId: item.id, action: "ingredient.updated" },
      }),
    ).toBe(1);
  });
  it("permits exactly one concurrent save for the same material version", async () => {
    const item = await material();
    const results = await Promise.allSettled([
      updateIngredient(admin, item.id, { ...item, notes: "first" }),
      updateIngredient(admin, item.id, { ...item, notes: "second" }),
    ]);
    expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((v) => v.status === "rejected") as PromiseRejectedResult)
        .reason,
    ).toMatchObject({ status: 409 });
    expect(
      await (
        await getReadyDb()
      ).auditLog.count({
        where: { entityId: item.id, action: "ingredient.updated" },
      }),
    ).toBe(1);
  });
  it("edits referenced spec and unit without rewriting purchases, contracts or their versions", async () => {
    const item = await material();
    const approved = await purchase(item.id);
    const draft = await purchase(item.id, "prj_sh", "DRAFT");
    await contract(item.id);
    const db = await getReadyDb();
    async function snapshots() {
      return {
        documents: await db.document.findMany({
          where: { id: { in: [approved.id, draft.id] } },
          include: { items: true },
          orderBy: { id: "asc" },
        }),
        contracts: await db.contract.findMany({ where: { ingredientId: item.id } }),
      };
    }
    const before = await snapshots();
    const result = await updateIngredient(admin, item.id, {
      ...item, unit: "袋", spec: "  500克/袋  ",
    });
    expect(result.ingredient).toMatchObject({
      id: item.id, unit: "袋", spec: "500克/袋", version: 2, referenced: true,
    });
    expect((await getIngredient(admin, item.id)).ingredient).toMatchObject(result.ingredient);
    expect(await snapshots()).toEqual(before);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: item.id, action: "ingredient.updated" },
    });
    expect(audit.beforeValue).toMatchObject({ unit: "斤", spec: "斤" });
    expect(audit.afterValue).toMatchObject({ unit: "袋", spec: "500克/袋" });
    expect((await ingredientHistory(admin, item.id, { unit: "斤" })).items[0])
      .toMatchObject({ spec: "斤", unit: "斤", quantity: 5, unitPrice: 4, amount: 20 });
  });
  it("edits spec independently and preserves a custom spec while changing unit", async () => {
    const item = await material();
    const edited = (await updateIngredient(admin, item.id, { ...item, spec: "散装大号" })).ingredient;
    expect(edited).toMatchObject({ spec: "散装大号", unit: "斤", version: 2 });
    const changed = (await updateIngredient(admin, item.id, { ...edited, unit: "袋" })).ingredient;
    expect(changed).toMatchObject({ spec: "散装大号", unit: "袋", version: 3 });
  });
  it.each(["", "公斤"])("defaults or normalizes spec %j to the unit", async (spec) => {
    const item = await material();
    expect((await updateIngredient(admin, item.id, { ...item, unit: "公斤", spec })).ingredient)
      .toMatchObject({ unit: "kg", spec: "kg" });
  });
  it("rejects duplicate spec/unit edits without changing metadata, aliases or version", async () => {
    const item = await material();
    const other = await material("袋", { name: item.name, normalizedName: normalizeName(item.name), spec: "500克", normalizedSpec: normalizeName("500克") });
    await expect(updateIngredient(admin, item.id, { ...item, unit: other.unit, spec: other.spec, aliases: ["不应保存"] }))
      .rejects.toMatchObject({ status: 409 });
    expect((await getIngredient(admin, item.id)).ingredient).toMatchObject({ unit: "斤", spec: "斤", version: 1, aliases: [] });
    expect(await (await getReadyDb()).auditLog.count({ where: { entityId: item.id } })).toBe(0);
  });
  it("changes an unreferenced unit and fills the corresponding spec", async () => {
    const item = await material();
    expect(
      (await updateIngredient(admin, item.id, { ...item, unit: "袋", spec: undefined }))
        .ingredient,
    ).toMatchObject({ unit: "袋", spec: "袋" });
  });
  it("creates another unit record without changing the original or its purchases", async () => {
    const item = await material();
    const doc = await purchase(item.id);
    const created = await createIngredientFromDocument(admin, {
      name: item.name,
      unit: "公斤",
      spec: "公斤",
      aliases: ["别称"],
      notes: "另一单位",
    });
    ingredientIds.push(created.id);
    expect(created).toMatchObject({ unit: "kg", spec: "kg" });
    expect(created.id).not.toBe(item.id);
    expect((await getIngredient(admin, item.id)).ingredient.unit).toBe("斤");
    expect(
      (
        await (
          await getReadyDb()
        ).documentItem.findUniqueOrThrow({ where: { id: doc.items[0].id } })
      ).unit,
    ).toBe("斤");
  });
  it("excludes disabled records from selectors but preserves existing document references", async () => {
    const item = await material();
    const doc = await purchase(item.id, "prj_sh", "DRAFT");
    await updateIngredient(admin, item.id, { ...item, active: false });
    expect((await listIngredients(staff, { q: item.name })).total).toBe(0);
    expect(
      (await listIngredients(admin, { q: item.name, status: "inactive" }))
        .total,
    ).toBe(1);
    await saveDocument(staff, doc.id, {
      version: doc.version,
      projectId: doc.projectId,
      docDate: "2026-10-25",
      supplierId: "sup_sh",
      totalAmount: 20,
      items: doc.items.map((v) => ({
        ...v,
        quantity: Number(v.quantity),
        unitPrice: Number(v.unitPrice),
        amount: Number(v.amount),
      })),
    });
    expect(
      (
        await (
          await getReadyDb()
        ).documentItem.findFirstOrThrow({ where: { documentId: doc.id } })
      ).ingredientId,
    ).toBe(item.id);
  });
  it.each([staff, finance])(
    "prevents metadata edits by $globalRole",
    async (user) => {
      const item = await material();
      await expect(
        updateIngredient(user, item.id, { ...item, notes: "禁止", spec: "大号", unit: "袋" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        listIngredients(user, { status: "all" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        createIngredientFromDocument(user, { name: "越权新增", unit: "斤" }),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it("scopes contract prices and approved purchase history to the staff project", async () => {
    const item = await material();
    await contract(item.id);
    await contract(item.id, "prj_hz");
    await purchase(item.id);
    await purchase(item.id, "prj_hz");
    await purchase(item.id, "prj_sh", "DRAFT");
    await purchase(item.id, "prj_sh", "APPROVED", "袋");
    expect((await getIngredient(staff, item.id)).contracts).toHaveLength(1);
    expect((await getIngredient(finance, item.id)).contracts).toHaveLength(2);
    const scoped = await ingredientHistory(staff, item.id, { unit: "斤" });
    expect(scoped).toMatchObject({ total: 1, pageSize: 20 });
    expect(scoped.items[0]).toMatchObject({
      quantity: 5,
      unitPrice: 4,
      amount: 20,
      name: "原单品名",
    });
    expect((await ingredientHistory(admin, item.id, {})).total).toBe(3);
    await expect(
      ingredientHistory(staff, item.id, { projectId: "prj_hz" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await ingredientHistory(staff, item.id, { from: "2026-10-26" })).total,
    ).toBe(0);
    await expect(
      ingredientHistory(admin, item.id, {
        from: "2026-10-27",
        to: "2026-10-20",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("paginates history without losing or repeating records and returns empty history honestly", async () => {
    const item = await material();
    expect((await ingredientHistory(admin, item.id, {})).total).toBe(0);
    for (let i = 0; i < 21; i++) await purchase(item.id);
    const a = await ingredientHistory(admin, item.id, {}),
      b = await ingredientHistory(admin, item.id, { page: 2 });
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(1);
    expect(new Set([...a.items, ...b.items].map((v) => v.id)).size).toBe(21);
  });
  it("rejects a cross-unit merge and preserves approved snapshots during a same-unit merge", async () => {
    const a = await material(),
      b = await material("袋"),
      c = await material();
    const approved = await purchase(a.id),
      pending = await purchase(a.id, "prj_sh", "DRAFT");
    await expect(
      mergeMasterData(admin, {
        type: "ingredient",
        sourceId: a.id,
        targetId: b.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const db = await getReadyDb(),
      before = await db.documentItem.findMany({
        where: { documentId: approved.id },
      });
    await mergeMasterData(admin, {
      type: "ingredient",
      sourceId: a.id,
      targetId: c.id,
    });
    expect(
      await db.documentItem.findMany({ where: { documentId: approved.id } }),
    ).toEqual(before);
    expect(
      (
        await db.documentItem.findFirstOrThrow({
          where: { documentId: pending.id },
        })
      ).ingredientId,
    ).toBe(c.id);
    expect((await getIngredient(admin, a.id)).ingredient).toMatchObject({
      active: false,
      version: 2,
    });
    expect((await getIngredient(admin, c.id)).ingredient.version).toBe(2);
  });
  it("keeps the three Excel sheets and supports optional notes while older templates retain notes", async () => {
    const template = new ExcelJS.Workbook();
    await template.xlsx.load(
      (await buildMasterTemplate()) as unknown as Parameters<
        typeof template.xlsx.load
      >[0],
    );
    expect(template.worksheets).toHaveLength(3);
    expect(template.getWorksheet("原材料")?.getRow(1).values).toContain("备注");
    const item = await material();
    async function sheet(withNotes: boolean) {
      const w = new ExcelJS.Workbook();
      w.addWorksheet("供应商").addRow(["名称", "联系人", "联系电话", "别名"]);
      const s = w.addWorksheet("原材料");
      s.addRow([
        "品名",
        "规格",
        "单位",
        "分类",
        "别名",
        ...(withNotes ? ["备注"] : []),
      ]);
      s.addRow([
        item.name,
        item.spec,
        item.unit,
        "测试分类",
        "",
        ...(withNotes ? ["可选备注"] : []),
      ]);
      w.addWorksheet("项目合同价").addRow([
        "项目点编码",
        "供应商名称",
        "品名",
        "规格",
        "单位",
        "单价",
        "生效日期",
        "截止日期",
      ]);
      return Buffer.from(await w.xlsx.writeBuffer());
    }
    expect(
      (await importMasterWorkbook(admin, await sheet(true), false)).errors,
    ).toHaveLength(0);
    expect((await getIngredient(admin, item.id)).ingredient.notes).toBe(
      "可选备注",
    );
    expect(
      (await importMasterWorkbook(admin, await sheet(false), false)).errors,
    ).toHaveLength(0);
    expect((await getIngredient(admin, item.id)).ingredient.notes).toBe(
      "可选备注",
    );
  });
});
