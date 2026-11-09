import type { Db } from "@/lib/prisma";
import { roundMoney } from "@/lib/text";
import { recomputeDocumentChecksInTransaction } from "@/server/checks";
import { testIngredients, testMasterBatch, testProjects, testSuppliers } from "./test-master-data";

const prefix = "test_master_20261101";
export const testPurchaseBatch = "test-purchases-20261101";
export const demoPriceNotice = "演示数据、价格虚构，仅供功能演示，不代表实际采购或市场报价。";
const basePrices = [
  2.4, 1.8, 2.6, 4.2, 3.4, 2.8, 1.6, 1.7, 2.1, 5.6,
  3.8, 4.8, 2.5, 6.5, 5.8, 16.8, 18.5, 22, 39, 12.5,
  5.8, 3, 4.6, 19.8, 8.5, 28, 118, 105, 68, 9.5,
];

export const testPurchaseDocuments = testProjects.flatMap((project, p) =>
  Array.from({ length: 3 }, (_, group) =>
    Array.from({ length: 3 }, (_, round) => {
      const status = round < 2 ? "APPROVED" as const
        : (["DRAFT", "PENDING_REVIEW", "NEEDS_REVISION"] as const)[group];
      return {
        id: `${prefix}_document_${p + 1}_${group + 1}_${round + 1}`,
        docNo: `DEMO-20261101-P${p + 1}-S${group + 1}-${round + 1}`,
        projectCode: project.code,
        supplierName: testSuppliers[p * 3 + group].name,
        status,
        date: round === 0 ? "2026-10-25" : "2026-11-01",
        items: Array.from({ length: 6 }, (_, line) => {
          const ingredientIndex = group * 10 + (line + round * 4) % 10;
          const ingredient = testIngredients[ingredientIndex];
          const price = basePrices[ingredientIndex] * (1 + p * 0.025 + round * 0.015);
          const unitPrice = roundMoney(price * (status === "PENDING_REVIEW" && line === 0 ? 1.45 : 1));
          const quantity = ingredient.unit === "斤" ? 12 + p * 3 + line * 2 + round : 2 + (p + line + round) % 4;
          return {
            ingredientIndex, name: ingredient.name, spec: ingredient.spec,
            unit: ingredient.unit, quantity, unitPrice,
            amount: roundMoney(quantity * unitPrice + (status === "NEEDS_REVISION" && line === 0 ? 6.5 : 0)),
          };
        }),
      };
    }),
  ).flat(),
);

// Every project has a fictional contract for all 30 materials, split across 3 suppliers.
export const testPurchaseContracts = testProjects.flatMap((project, p) =>
  testIngredients.map((ingredient, i) => ({
    id: `${prefix}_contract_${p + 1}_${i + 1}`,
    projectCode: project.code,
    supplierName: testSuppliers[p * 3 + Math.floor(i / 10)].name,
    ingredientIndex: i,
    spec: ingredient.spec, unit: ingredient.unit,
    unitPrice: roundMoney(basePrices[i] * (1 + p * 0.025) * 1.08),
  })),
);

/** Add manual demonstration documents only; no images, OCR calls, messages or account edits. */
export async function seedTestPurchases(db: Db, apply = false) {
  return db.$transaction(async (tx) => {
    const author = await tx.user.findFirst({ where: { active: true, globalRole: "ADMIN" }, orderBy: { id: "asc" } });
    if (!author) throw new Error("演示采购数据需要已有的启用管理员；不会自动创建账号。");
    const projectIds = new Map<string, string>();
    const supplierIds = new Map<string, string>();
    const ingredientIds: string[] = [];
    for (const fixture of testProjects) {
      const row = await tx.project.findUnique({ where: { code: fixture.code } });
      if (!row?.active || row.id !== fixture.id) throw new Error(`先导入批次 ${testMasterBatch} 的测试项目，且保持启用。`);
      projectIds.set(fixture.code, row.id);
    }
    for (const fixture of testSuppliers) {
      const row = await tx.supplier.findUnique({ where: { name: fixture.name } });
      if (!row?.active || row.id !== fixture.id) throw new Error(`先导入批次 ${testMasterBatch} 的测试供应商，且保持启用。`);
      supplierIds.set(fixture.name, row.id);
    }
    for (const fixture of testIngredients) {
      const row = await tx.ingredient.findUnique({
        where: { normalizedName_normalizedSpec_unit: {
          normalizedName: fixture.normalizedName, normalizedSpec: fixture.normalizedSpec, unit: fixture.unit,
        } },
      });
      if (!row?.active) throw new Error(`测试材料 ${fixture.name} 不存在或已停用。`);
      ingredientIds.push(row.id);
    }
    const planned = { contracts: 0, documents: 0, items: 0 };
    let skippedDeleted = 0;
    const createdIds = { contracts: [] as string[], documents: [] as string[] };
    for (const fixture of testPurchaseContracts) {
      if (await tx.contract.findUnique({ where: { id: fixture.id } })) continue;
      const projectId = projectIds.get(fixture.projectCode)!;
      const supplierId = supplierIds.get(fixture.supplierName)!;
      const ingredientId = ingredientIds[fixture.ingredientIndex];
      // Respect manually maintained contracts too; never insert an overlapping demo price.
      if (await tx.contract.findFirst({ where: { projectId, supplierId, ingredientId } })) continue;
      planned.contracts++;
      if (apply) {
        await tx.contract.create({ data: {
          id: fixture.id, projectId, supplierId, ingredientId,
          spec: fixture.spec, unit: fixture.unit, unitPrice: fixture.unitPrice,
          startsOn: new Date("2026-10-01T00:00:00+08:00"),
          endsOn: new Date("2026-12-31T23:59:59+08:00"),
          createdById: author.id,
        } });
        createdIds.contracts.push(fixture.id);
      }
    }
    for (const fixture of testPurchaseDocuments) {
      if (await tx.document.findUnique({ where: { id: fixture.id } })) continue;
      if (await tx.auditLog.findFirst({ where: {
        entityType: "document", entityId: fixture.id, action: "document.deleted",
      } })) {
        skippedDeleted++;
        continue;
      }
      if (await tx.document.findFirst({ where: { docNo: fixture.docNo } })) {
        throw new Error(`演示单号 ${fixture.docNo} 已被其他单据使用，整批取消。`);
      }
      planned.documents++;
      planned.items += fixture.items.length;
      if (!apply) continue;
      const subtotal = roundMoney(fixture.items.reduce((sum, item) => sum + item.amount, 0));
      const docDate = new Date(`${fixture.date}T00:00:00+08:00`);
      const returned = fixture.status === "NEEDS_REVISION";
      const reviewed = fixture.status === "APPROVED" || returned;
      const reviewNote = returned
        ? `${demoPriceNotice}【退回示例】第一行金额故意增加6.50元，请核对数量×单价后重新提交；此状态由演示脚本生成。`
        : `${demoPriceNotice}审核状态由演示脚本生成，不代表真实人工审批。`;
      const notes = `${demoPriceNotice} 批次 ${testPurchaseBatch}；手工录入示例，无原图。${
        fixture.status === "PENDING_REVIEW" ? "【异常演示】第一行单价故意上浮，展示合同价及历史比价提醒。"
          : returned ? "【退回演示】第一行金额故意不勾稽。" : ""
      }`;
      await tx.document.create({ data: {
        id: fixture.id, docNo: fixture.docNo, docDate,
        projectId: projectIds.get(fixture.projectCode)!,
        supplierId: supplierIds.get(fixture.supplierName)!,
        ocrSupplierName: fixture.supplierName,
        supplierMatchStatus: "MATCHED", supplierMatchScore: 1,
        status: "DRAFT", subtotal, totalAmount: subtotal, notes,
        createdById: author.id, createdAt: new Date(`${fixture.date}T00:00:15+08:00`),
        items: { create: fixture.items.map((item, line) => ({
          id: `${fixture.id}_item_${line + 1}`, lineNo: line + 1,
          name: item.name, spec: item.spec, unit: item.unit,
          quantity: item.quantity, unitPrice: item.unitPrice, amount: item.amount,
          ingredientId: ingredientIds[item.ingredientIndex],
          confidence: 1, matchStatus: "MATCHED", matchScore: 1,
        })) },
      } });
      const checks = await recomputeDocumentChecksInTransaction(tx, fixture.id);
      if (fixture.status === "APPROVED" && checks.some((check) => check.severity === "ERROR")) {
        throw new Error(`演示已通过单据 ${fixture.docNo} 存在严重异常，整批取消。`);
      }
      await tx.document.update({ where: { id: fixture.id }, data: {
        status: fixture.status,
        submittedAt: fixture.status === "DRAFT" ? null : new Date(`${fixture.date}T00:01:00+08:00`),
        reviewedById: reviewed ? author.id : null,
        reviewedAt: reviewed ? new Date(`${fixture.date}T00:02:00+08:00`) : null,
        reviewNote: reviewed ? reviewNote : "",
      } });
      if (reviewed) {
        await tx.approvalRecord.create({ data: {
          documentId: fixture.id, reviewerId: author.id,
          action: returned ? "RETURN" : "APPROVE", note: reviewNote,
          beforeValue: { status: "PENDING_REVIEW", synthetic: true },
          afterValue: { status: fixture.status, synthetic: true, batch: testPurchaseBatch },
        } });
      }
      if (fixture.status === "APPROVED") {
        await tx.checkResult.updateMany({ where: { documentId: fixture.id }, data: { status: "RESOLVED" } });
      }
      await tx.auditLog.create({ data: {
        entityType: "document", entityId: fixture.id, documentId: fixture.id,
        userId: author.id, action: "demo.document.seeded",
        afterValue: { batch: testPurchaseBatch, synthetic: true, entryMode: "MANUAL", status: fixture.status, notice: demoPriceNotice },
      } });
      createdIds.documents.push(fixture.id);
    }
    const created = {
      contracts: createdIds.contracts.length, documents: createdIds.documents.length,
      items: apply ? planned.items : 0,
    };
    if (apply && (created.documents || created.contracts)) {
      await tx.auditLog.create({ data: {
        entityType: "testDataBatch", entityId: testPurchaseBatch,
        userId: author.id, action: "test.purchases.seeded",
        afterValue: { batch: testPurchaseBatch, notice: demoPriceNotice, created, createdIds },
      } });
    }
    return { batch: testPurchaseBatch, applied: apply, planned, created, createdIds, skippedDeleted };
  }, { timeout: 60_000 });
}
