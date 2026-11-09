import { afterAll, expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { seedTestMasterData, testIngredients, testMasterBatch, testProjects, testSuppliers } from "@/server/test-master-data";
import { demoPriceNotice, seedTestPurchases, testPurchaseBatch, testPurchaseContracts, testPurchaseDocuments } from "@/server/test-purchases";
import { roundMoney } from "@/lib/text";

const documentIds = testPurchaseDocuments.map((row) => row.id);
afterAll(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { id: { in: documentIds } } });
  await db.auditLog.deleteMany({ where: { entityType: "document", entityId: { in: documentIds } } });
  await db.contract.deleteMany({ where: { id: { in: testPurchaseContracts.map((row) => row.id) } } });
  await db.auditLog.deleteMany({ where: { entityType: "testDataBatch", entityId: { in: [testMasterBatch, testPurchaseBatch] } } });
  await db.project.deleteMany({ where: { id: { in: testProjects.map((row) => row.id) } } });
  await db.supplier.deleteMany({ where: { id: { in: testSuppliers.map((row) => row.id) } } });
  await db.ingredient.deleteMany({ where: { id: { in: testIngredients.map((row) => row.id) } } });
});

it("adds fictional, balanced approved purchases and actionable exception examples atomically and idempotently", async () => {
  const db = await getReadyDb();
  await seedTestMasterData(db, true);
  const existingDocuments = await db.document.findMany({ orderBy: { id: "asc" } });
  const memberships = await db.projectMembership.findMany({ orderBy: { id: "asc" } });
  const before = { documents: await db.document.count(), contracts: await db.contract.count(), audit: await db.auditLog.count() };
  const preview = await seedTestPurchases(db);
  expect(preview.planned).toEqual({ contracts: 150, documents: 45, items: 270 });
  expect(preview.created).toEqual({ contracts: 0, documents: 0, items: 0 });
  expect({ documents: await db.document.count(), contracts: await db.contract.count(), audit: await db.auditLog.count() }).toEqual(before);

  // An occupied document number must undo contracts inserted earlier in this transaction.
  const author = await db.user.findFirstOrThrow({ where: { globalRole: "ADMIN" } });
  const collision = await db.document.create({ data: {
    docNo: testPurchaseDocuments[0].docNo, docDate: new Date(),
    projectId: testProjects[0].id, createdById: author.id, status: "DRAFT",
  } });
  await expect(seedTestPurchases(db, true)).rejects.toThrow("整批取消");
  expect(await db.contract.count()).toBe(before.contracts);
  expect(await db.document.count()).toBe(before.documents + 1);
  await db.document.delete({ where: { id: collision.id } });

  const applied = await seedTestPurchases(db, true);
  expect(applied.created).toEqual(preview.planned);
  const docs = await db.document.findMany({
    where: { id: { in: documentIds } }, include: { items: true, checks: true, approvals: true, pages: true },
  });
  expect(docs.filter((doc) => doc.status === "APPROVED")).toHaveLength(30);
  for (const status of ["DRAFT", "PENDING_REVIEW", "NEEDS_REVISION"]) {
    expect(docs.filter((doc) => doc.status === status)).toHaveLength(5);
  }
  expect(new Set(docs.map((doc) => doc.projectId)).size).toBe(5);
  expect(new Set(docs.map((doc) => doc.supplierId)).size).toBe(15);
  expect(new Set(docs.flatMap((doc) => doc.items.map((item) => item.ingredientId))).size).toBe(30);
  for (const doc of docs) {
    expect(doc.notes).toContain(demoPriceNotice);
    expect(doc.pages).toHaveLength(0);
    expect(Number(doc.totalAmount)).toBe(roundMoney(doc.items.reduce((sum, item) => sum + Number(item.amount), 0)));
    if (doc.status === "APPROVED") {
      expect(doc.checks.every((check) => check.severity !== "ERROR" && check.status === "RESOLVED")).toBe(true);
      expect(doc.approvals[0]?.note).toContain("演示脚本");
      for (const item of doc.items) {
        expect(Number(item.amount)).toBe(roundMoney(Number(item.quantity) * Number(item.unitPrice)));
      }
    }
    if (doc.status === "PENDING_REVIEW") expect(doc.checks.some((check) => check.type === "contract_price")).toBe(true);
    if (doc.status === "NEEDS_REVISION") expect(doc.checks.some((check) => check.type === "line_arithmetic")).toBe(true);
  }
  const countAfter = await db.auditLog.count();
  expect((await seedTestPurchases(db, true)).created).toEqual({ contracts: 0, documents: 0, items: 0 });
  expect(await db.auditLog.count()).toBe(countAfter);
  expect(await db.document.findMany({ where: { id: { notIn: documentIds } }, orderBy: { id: "asc" } })).toEqual(existingDocuments);
  expect(await db.projectMembership.findMany({ orderBy: { id: "asc" } })).toEqual(memberships);

  const deletedId = docs.find((doc) => doc.status === "NEEDS_REVISION")!.id;
  await db.document.delete({ where: { id: deletedId } });
  await db.auditLog.create({ data: { entityType: "document", entityId: deletedId, action: "document.deleted" } });
  const afterManualDelete = await seedTestPurchases(db, true);
  expect(afterManualDelete.created).toEqual({ contracts: 0, documents: 0, items: 0 });
  expect(afterManualDelete.skippedDeleted).toBe(1);
  expect(await db.document.findUnique({ where: { id: deletedId } })).toBeNull();
}, 60_000);
