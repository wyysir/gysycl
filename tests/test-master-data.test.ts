import { afterAll, expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { seedTestMasterData, testIngredients, testMasterBatch, testProjects, testSuppliers } from "@/server/test-master-data";

afterAll(async () => {
  const db = await getReadyDb();
  await db.auditLog.deleteMany({ where: { entityType: "testDataBatch", entityId: testMasterBatch } });
  await db.project.deleteMany({ where: { id: { in: testProjects.map((row) => row.id) } } });
  await db.supplier.deleteMany({ where: { id: { in: testSuppliers.map((row) => row.id) } } });
  await db.ingredient.deleteMany({ where: { id: { in: testIngredients.map((row) => row.id) } } });
});

it("previews without writes, preserves existing data and adds audited test masters only once", async () => {
  const db = await getReadyDb();
  const protectedBefore = {
    users: await db.user.findMany({ orderBy: { id: "asc" } }),
    documents: await db.document.findMany({ orderBy: { id: "asc" } }),
    memberships: await db.projectMembership.findMany({ orderBy: { id: "asc" } }),
  };
  const original = await db.project.create({
    data: { ...testProjects[0], name: "人工维护名称", active: false },
  });
  const counts = [await db.project.count(), await db.supplier.count(), await db.ingredient.count(), await db.auditLog.count()];
  const preview = await seedTestMasterData(db);
  expect(preview.applied).toBe(false);
  expect(preview.planned).toEqual({ projects: 4, suppliers: 15, ingredients: 30 });
  expect(preview.created).toEqual({ projects: 0, suppliers: 0, ingredients: 0 });
  expect([await db.project.count(), await db.supplier.count(), await db.ingredient.count(), await db.auditLog.count()]).toEqual(counts);

  // Force a failure after project inserts; the whole batch must roll back.
  await db.supplier.create({ data: { ...testSuppliers[0], name: "占用批次编号的既有供应商" } });
  await expect(seedTestMasterData(db, true)).rejects.toThrow();
  expect(await db.project.count()).toBe(counts[0]);
  expect(await db.ingredient.count()).toBe(counts[2]);
  expect(await db.auditLog.count()).toBe(counts[3]);
  await db.supplier.delete({ where: { id: testSuppliers[0].id } });

  const first = await seedTestMasterData(db, true);
  expect(first.created).toEqual(preview.planned);
  expect(await db.project.findUnique({ where: { id: original.id } })).toEqual(original);
  expect(await db.ingredient.findMany({ where: { id: { in: first.createdIds.ingredients } } }))
    .toEqual(expect.arrayContaining(testIngredients.map((row) => expect.objectContaining(row))));
  const auditCount = await db.auditLog.count();
  expect(auditCount).toBe(counts[3] + 1);

  const second = await seedTestMasterData(db, true);
  expect(second.created).toEqual({ projects: 0, suppliers: 0, ingredients: 0 });
  expect(second.existing).toEqual({ projects: 5, suppliers: 15, ingredients: 30 });
  expect(await db.auditLog.count()).toBe(auditCount);
  expect({
    users: await db.user.findMany({ orderBy: { id: "asc" } }),
    documents: await db.document.findMany({ orderBy: { id: "asc" } }),
    memberships: await db.projectMembership.findMany({ orderBy: { id: "asc" } }),
  }).toEqual(protectedBefore);
});
