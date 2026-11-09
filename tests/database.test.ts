import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getReadyDb } from "@/lib/bootstrap";
import { suggestIngredients, suggestSuppliers } from "@/server/master-data";
import { buildMasterTemplate, importMasterWorkbook } from "@/server/excel";

describe("seeded database and matching", () => {
  beforeAll(async () => {
    await getReadyDb();
  });

  it("seeds projects, documents and checks", async () => {
    const db = await getReadyDb();
    expect(await db.project.count()).toBeGreaterThanOrEqual(4);
    expect(await db.document.count()).toBeGreaterThanOrEqual(8);
    expect(await db.checkResult.count()).toBeGreaterThan(0);
  });

  it("returns the correct top suggestion for handwritten OCR errors", async () => {
    const db = await getReadyDb();
    const cabbage = await suggestIngredients(db, "青莱");
    const potato = await suggestIngredients(db, "士豆");
    const supplier = await suggestSuppliers(db, "鲜禾农副");
    expect(cabbage[0]?.name).toBe("青菜");
    expect(potato[0]?.name).toBe("土豆");
    expect(supplier[0]?.name).toContain("鲜禾");
  });

  it("generates a three-sheet Excel template", async () => {
    const buffer = await buildMasterTemplate();
    expect(buffer.length).toBeGreaterThan(5_000);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("validates and imports a complete master-data workbook", async () => {
    const db = await getReadyDb();
    const admin = await db.user.findUniqueOrThrow({
      where: { employeeNo: "admin" },
    });
    const workbook = new ExcelJS.Workbook();
    const suppliers = workbook.addWorksheet("供应商");
    suppliers.addRow(["名称", "联系人", "联系电话", "别名"]);
    suppliers.addRow(["测试蔬菜供应商", "测试员", "13900000000", "测试菜商"]);
    const ingredients = workbook.addWorksheet("原材料");
    ingredients.addRow(["品名", "规格", "单位", "分类", "别名"]);
    ingredients.addRow(["测试西兰花", "散装", "kg", "蔬菜", "青花菜"]);
    const contracts = workbook.addWorksheet("项目合同价");
    contracts.addRow([
      "项目点编码",
      "供应商名称",
      "品名",
      "规格",
      "单位",
      "单价",
      "生效日期",
      "截止日期",
    ]);
    contracts.addRow([
      "SH-HQ",
      "测试蔬菜供应商",
      "测试西兰花",
      "散装",
      "kg",
      8.5,
      "2026-01-01",
      "2026-12-31",
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await importMasterWorkbook(
      {
        id: admin.id,
        employeeNo: admin.employeeNo,
        name: admin.name,
        globalRole: "ADMIN",
        memberships: [],
      },
      buffer,
      true,
    );
    expect(result.errors).toHaveLength(0);
    expect(result.summary).toMatchObject({
      suppliers: 1,
      ingredients: 1,
      contracts: 1,
    });
  });

  it("rejects an invalid workbook as a whole", async () => {
    const db = await getReadyDb();
    const before = await db.contract.count();
    const admin = await db.user.findUniqueOrThrow({
      where: { employeeNo: "admin" },
    });
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("供应商").addRow(["名称"]);
    workbook.addWorksheet("原材料").addRow(["品名", "规格", "单位", "分类", "别名"]);
    const contracts = workbook.addWorksheet("项目合同价");
    contracts.addRow([
      "项目点编码",
      "供应商名称",
      "品名",
      "规格",
      "单位",
      "单价",
      "生效日期",
      "截止日期",
    ]);
    contracts.addRow([
      "NOT-EXIST",
      "某供应商",
      "某原材料",
      "散装",
      "kg",
      3,
      "2026-01-01",
      "",
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await importMasterWorkbook(
      {
        id: admin.id,
        employeeNo: admin.employeeNo,
        name: admin.name,
        globalRole: "ADMIN",
        memberships: [],
      },
      buffer,
      true,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(await db.contract.count()).toBe(before);
  });
});
