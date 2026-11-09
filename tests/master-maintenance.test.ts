import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { buildMasterTemplate, importMasterWorkbook } from "@/server/excel";
import { bulkMaintainIngredients, ingredientCategories, maintainCategory } from "@/server/ingredient-maintenance";
import type { SessionUser } from "@/server/auth";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const finance: SessionUser = { ...admin, globalRole: "FINANCE" };
const prefix = "维护回归" + randomUUID();
afterAll(async () => {
  const db = await getReadyDb();
  const rows = await db.ingredient.findMany({where: {name: {startsWith: prefix}}});
  await db.auditLog.deleteMany({where: {OR: [{entityType: "ingredient", entityId: {in: rows.map(row => row.id)}}, {entityType: "ingredientCategory", entityId: {startsWith: prefix}}]}});
  await db.ingredient.deleteMany({where: {id: {in: rows.map(row => row.id)}}});
  const setting = await db.systemSetting.findUnique({where: {key: "ingredient.categories"}});
  if (setting) await db.systemSetting.update({where: {key: setting.key}, data: {value: (setting.value as {name: string; active: boolean}[]).filter(item => !item.name.startsWith(prefix))}});
});
async function workbook(type: "ingredients" | "suppliers" = "ingredients") {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await buildMasterTemplate(type) as unknown as ExcelJS.Buffer);
  return w;
}
async function bytes(w: ExcelJS.Workbook) { return Buffer.from(await w.xlsx.writeBuffer()); }

describe("基础资料维护操作", () => {
  it("独立原材料模板含单位，填一张表即可导入并保留单位", async () => {
    const w = await workbook();
    expect(w.worksheets.map(sheet => sheet.name)).toEqual(["原材料"]);
    expect(w.worksheets[0].getRow(1).values).toContain("单位");
    w.worksheets[0].addRow([prefix, "袋装", "斤", "", "", "单位回归"]);
    expect((await importMasterWorkbook(admin, await bytes(w), true, "ingredients")).errors).toEqual([]);
    expect((await importMasterWorkbook(admin, await bytes(w), false, "ingredients")).errors).toEqual([]);
    expect(await (await getReadyDb()).ingredient.findFirst({where: {name: prefix}})).toMatchObject({unit: "斤", spec: "袋装"});
  });
  it("上传供应商文件到原材料入口时拒绝", async () => {
    const w = await workbook("suppliers"); w.worksheets[0].addRow(["不可误导入"]);
    const result = await importMasterWorkbook(admin, await bytes(w), false, "ingredients");
    expect(result.errors.some(error => error.message.includes("原材料"))).toBe(true);
  });
  it("缺单位列、单位为空、空模板均拒绝", async () => {
    const w = await workbook();
    expect((await importMasterWorkbook(admin, await bytes(w), true, "ingredients")).errors.length).toBeGreaterThan(0);
    w.worksheets[0].addRow([prefix + "空单位"]);
    expect((await importMasterWorkbook(admin, await bytes(w), true, "ingredients")).errors.some(error => error.message.includes("单位"))).toBe(true);
    w.worksheets[0].getCell("C1").value = "误改列名";
    expect((await importMasterWorkbook(admin, await bytes(w), true, "ingredients")).errors.some(error => error.row === 1 && error.message.includes("单位"))).toBe(true);
  });
  it("批量启停、冲突整批回滚、权限和审计", async () => {
    const db = await getReadyDb();
    const item = await db.ingredient.findFirstOrThrow({where: {name: prefix}});
    const input = {items: [{id: item.id, version: item.version}], active: false};
    await expect(bulkMaintainIngredients(finance, input)).rejects.toMatchObject({status: 403});
    await bulkMaintainIngredients(admin, input);
    expect(await db.ingredient.findUnique({where: {id: item.id}})).toMatchObject({active: false, unit: "斤"});
    await expect(bulkMaintainIngredients(admin, input)).rejects.toMatchObject({status: 409});
    const updated = await db.ingredient.findUniqueOrThrow({where: {id: item.id}});
    await expect(bulkMaintainIngredients(admin, {items: [{id: item.id, version: updated.version}, {id: "missing", version: 1}], active: true})).rejects.toMatchObject({status: 409});
    expect((await db.ingredient.findUniqueOrThrow({where: {id: item.id}})).active).toBe(false);
    await bulkMaintainIngredients(admin, {items: [{id: item.id, version: updated.version}], active: true});
    expect(await db.auditLog.count({where: {entityId: item.id, action: "ingredient.bulkUpdated"}})).toBe(2);
  });
  it("分类可新增、分配、改名、停用，版本冲突及停用分类导入被拒绝", async () => {
    const name = prefix + "分类";
    let categories = await ingredientCategories();
    await maintainCategory(admin, {name, active: true, version: categories.version});
    categories = await ingredientCategories();
    expect(categories.categories.some(item => item.name === name && item.count === 0)).toBe(true);
    const db = await getReadyDb(), item = await db.ingredient.findFirstOrThrow({where: {name: prefix}});
    await bulkMaintainIngredients(admin, {items: [{id: item.id, version: item.version}], category: name});
    await maintainCategory(admin, {previousName: name, name: name + "改", active: false, version: categories.version});
    expect((await db.ingredient.findUniqueOrThrow({where: {id: item.id}})).category).toBe(name + "改");
    await expect(maintainCategory(admin, {name: name + "冲突", active: true, version: "stale"})).rejects.toMatchObject({status: 409});
    const updated = await db.ingredient.findUniqueOrThrow({where: {id: item.id}});
    await expect(bulkMaintainIngredients(admin, {items: [{id: item.id, version: updated.version}], category: name + "改"})).rejects.toMatchObject({status: 400});
    const w = await workbook();w.worksheets[0].addRow([prefix, "袋装", "斤", name + "改"]);
    expect((await importMasterWorkbook(admin, await bytes(w), true, "ingredients")).errors.some(error => error.message.includes("分类已停用"))).toBe(true);
  });
});
