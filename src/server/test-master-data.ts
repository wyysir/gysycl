import type { Db } from "@/lib/prisma";
import { normalizeName } from "@/lib/text";

export const testMasterBatch = "test-master-20261101";
const idPrefix = "test_master_20261101";

export const testProjects = [
  ["TEST-SH-HQ", "测试·上海总部食堂", "华东"],
  ["TEST-HZ-PARK", "测试·杭州园区食堂", "华东"],
  ["TEST-SZ-FACTORY", "测试·苏州工厂食堂", "华东"],
  ["TEST-NJ-HOSPITAL", "测试·南京医院食堂", "华东"],
  ["TEST-NB-SCHOOL", "测试·宁波学校食堂", "华东"],
].map(([code, name, region], index) => ({
  id: `${idPrefix}_project_${index + 1}`, code, name, region,
}));

// Fictional suppliers; leave phone numbers empty to avoid real contact details.
export const testSuppliers = [
  "鲜禾蔬菜配送", "绿源农产品", "丰味鲜肉配送", "每日鲜禽蛋",
  "华东粮油配送", "江南豆制品", "海润水产配送", "四季水果配送",
  "金穗米面配送", "百味调味品", "安心冷冻食品", "晨光乳品配送",
  "田园菌菇配送", "五谷干货配送", "优鲜综合食材",
].map((label, index) => ({
  id: `${idPrefix}_supplier_${index + 1}`,
  name: `测试·${label}供应商`,
  normalizedName: normalizeName(`测试·${label}供应商`),
  contactName: "测试联系人",
  contactPhone: "",
}));

export const testIngredients = [
  ["青菜", "斤", "蔬菜"], ["白菜", "斤", "蔬菜"],
  ["土豆", "斤", "蔬菜"], ["西红柿", "斤", "蔬菜"],
  ["黄瓜", "斤", "蔬菜"], ["胡萝卜", "斤", "蔬菜"],
  ["白萝卜", "斤", "蔬菜"], ["冬瓜", "斤", "蔬菜"],
  ["南瓜", "斤", "蔬菜"], ["西兰花", "斤", "蔬菜"],
  ["花菜", "斤", "蔬菜"], ["莲藕", "斤", "蔬菜"],
  ["洋葱", "斤", "蔬菜"], ["生姜", "斤", "调味"],
  ["大蒜", "斤", "调味"], ["猪五花肉", "斤", "肉禽"],
  ["猪瘦肉", "斤", "肉禽"], ["猪排骨", "斤", "肉禽"],
  ["牛肉", "斤", "肉禽"], ["鸡胸肉", "斤", "肉禽"],
  ["鸡蛋", "斤", "蛋类"], ["豆腐", "斤", "豆制品"],
  ["香干", "斤", "豆制品"], ["鲈鱼", "斤", "水产"],
  ["草鱼", "斤", "水产"], ["虾仁", "斤", "水产"],
  ["大米", "袋", "粮油"], ["面粉", "袋", "粮油"],
  ["食用油", "桶", "粮油"], ["生抽", "瓶", "调味"],
].map(([name, unit, category], index) => ({
  id: `${idPrefix}_ingredient_${index + 1}`,
  name, normalizedName: normalizeName(name),
  spec: unit, normalizedSpec: normalizeName(unit), unit, category,
  notes: `测试数据；批次 ${testMasterBatch}；规格与单位一致，非实际采购记录。`,
}));

/** Explicit top-up only. Never called by bootstrap, never resets or edits existing data. */
export async function seedTestMasterData(db: Db, apply = false) {
  return db.$transaction(async (tx) => {
    const planned = { projects: 0, suppliers: 0, ingredients: 0 };
    const existing = { projects: 0, suppliers: 0, ingredients: 0 };
    const createdIds = {
      projects: [] as string[], suppliers: [] as string[], ingredients: [] as string[],
    };
    for (const row of testProjects) {
      if (await tx.project.findUnique({ where: { code: row.code } })) {
        existing.projects++;
      } else {
        planned.projects++;
        if (apply) {
          await tx.project.create({ data: row });
          createdIds.projects.push(row.id);
        }
      }
    }
    for (const row of testSuppliers) {
      if (await tx.supplier.findUnique({ where: { name: row.name } })) {
        existing.suppliers++;
      } else {
        planned.suppliers++;
        if (apply) {
          await tx.supplier.create({ data: row });
          createdIds.suppliers.push(row.id);
        }
      }
    }
    for (const row of testIngredients) {
      const key = {
        normalizedName: row.normalizedName,
        normalizedSpec: row.normalizedSpec,
        unit: row.unit,
      };
      if (await tx.ingredient.findUnique({ where: { normalizedName_normalizedSpec_unit: key } })) {
        existing.ingredients++;
      } else {
        planned.ingredients++;
        if (apply) {
          await tx.ingredient.create({ data: row });
          createdIds.ingredients.push(row.id);
        }
      }
    }
    const created = {
      projects: createdIds.projects.length,
      suppliers: createdIds.suppliers.length,
      ingredients: createdIds.ingredients.length,
    };
    if (apply && Object.values(created).some((count) => count > 0)) {
      await tx.auditLog.create({
        data: {
          entityType: "testDataBatch", entityId: testMasterBatch,
          action: "test.masterData.seeded",
          afterValue: { batch: testMasterBatch, created, createdIds },
        },
      });
    }
    const activeTotals = {
      projects: await tx.project.count({ where: { active: true } }),
      suppliers: await tx.supplier.count({ where: { active: true } }),
      ingredients: await tx.ingredient.count({ where: { active: true } }),
    };
    return { batch: testMasterBatch, applied: apply, planned, existing, created, createdIds, activeTotals };
  }, { timeout: 30_000 });
}
