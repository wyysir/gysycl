import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canConfirmRounding, validRounding, type RoundingItem } from "@/domain/rounding";
import { getReadyDb } from "@/lib/bootstrap";
import { createManualDocument } from "@/server/documents";
import { saveDocument, submitDocument, reviewDocument } from "@/server/document-service";
import type { SessionUser } from "@/server/auth";
const item = { name: "青菜", unit: "kg", ingredientId: "ing_qc", quantity: 42.2, unitPrice: 1.2, amount: 50.60 };
const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
describe("explicit line rounding", () => {
  it("adds nullable confirmation storage without changing old amounts", async () => {
    const db = await getReadyDb();
    const migration = readFileSync(path.join(process.cwd(), "prisma/migrations/0003_line_rounding/migration.sql"), "utf8");
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "RoundingMigrationProbe" (id TEXT, amount NUMERIC) ON COMMIT DROP');
      await tx.$executeRawUnsafe('INSERT INTO "RoundingMigrationProbe" VALUES (\'old-line\', 50.60)');
      await tx.$executeRawUnsafe(migration.replace('"DocumentItem"', '"RoundingMigrationProbe"'));
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; amount: unknown; roundingAdjustment: unknown }>>('SELECT * FROM "RoundingMigrationProbe"');
      expect(rows[0].id).toBe("old-line");
      expect(Number(rows[0].amount)).toBe(50.60);
      expect(rows[0].roundingAdjustment).toBeNull();
    });
  });
  it.each([50.63, 50.60, 49.65])("allows a reduction up to 0.99 (%s)", amount => expect(canConfirmRounding({ ...item, amount })).toBe(true));
  it.each([49.64, 50.65, 50.64, -1, 50.601])("rejects invalid rounding amount %s", amount => expect(canConfirmRounding({ ...item, amount })).toBe(false));
  it("requires a matching, attributable confirmation instead of silently tolerating a difference", () => {
    expect(validRounding(item, null)).toBe(false);
    const record = { ...item, adjustmentAmount: -0.04, confirmedBy: admin.id, confirmedAt: new Date().toISOString(), reason: "供应商抹零" };
    expect(validRounding(item, record)).toBe(true);
    for (const patch of [{ quantity: 42 }, { unitPrice: 1.21 }, { amount: 50.61 }, { unit: "斤" }, { ingredientId: null }, { name: "白菜" }]) expect(validRounding({ ...item, ...patch }, record)).toBe(false);
    expect(validRounding(item, { ...record, adjustmentAmount: -0.05 })).toBe(false);
  });
  it("persists attribution, supports revoke/reconfirm, invalidates changed numbers and permits ordinary approval only after correction", async () => {
    const db = await getReadyDb();
    const doc = await createManualDocument({ userId: admin.id, projectId: "prj_sh", docDate: new Date("2026-10-31") });
    let version = doc.version;
    async function save(row: Omit<RoundingItem,"unitPrice"|"amount"> & {unitPrice:number|null;amount:number|null;id?: string; roundingConfirmed?: boolean }) {
      const result = await saveDocument(admin, doc.id, { version, docDate: "2026-10-31", projectId: "prj_sh", supplierId: "sup_sh", totalAmount: row.amount, items: [{ ...row, confidence: 1 }] });
      version = result.document.version; return result.document;
    }
    const hasError = () => db.checkResult.count({ where: { documentId: doc.id, type: "line_arithmetic", severity: "ERROR" } });
    try {
      let current = await save(item);
      expect(await hasError()).toBe(1);
      await submitDocument(admin, doc.id);
      await expect(reviewDocument(admin, doc.id, { action: "approve" })).rejects.toThrow("严重异常");
      // Return to an editable state as a supervisor, preserving the normal workflow.
      await reviewDocument(admin, doc.id, { action: "return", note: "请确认是否抹零" });
      version = (await db.document.findUniqueOrThrow({ where: { id: doc.id } })).version;
      current = await save({ ...current.items[0], roundingConfirmed: true });
      expect(await hasError()).toBe(0);
      expect(current.items[0].roundingAdjustment).toMatchObject({ confirmedBy: admin.id, adjustmentAmount: -0.04, reason: "供应商抹零" });
      const proof = current.items[0].roundingAdjustment;
      current = await save({ ...current.items[0] });
      expect(current.items[0].roundingAdjustment).toEqual(proof);
      current = await save({ ...current.items[0], roundingConfirmed: false });
      expect(await hasError()).toBe(1); expect(current.items[0].roundingAdjustment).toBeNull();
      current = await save({ ...current.items[0], roundingConfirmed: true });
      // Omitted confirmation on a changed row must not inherit the old exception.
      current = await save({ ...item, id: current.items[0].id, amount: 50.63 });
      expect(await hasError()).toBe(1); expect(current.items[0].roundingConfirmed).toBe(false);
      await expect(save({ ...item, amount: 49.64, roundingConfirmed: true })).rejects.toThrow("0.99");
      await expect(save({ ...item, amount: 50.65, roundingConfirmed: true })).rejects.toThrow("0.99");
      current = await save({ ...current.items[0], roundingConfirmed: true });
      const audit = await db.auditLog.findFirstOrThrow({ where: { documentId: doc.id, action: "document.updated" }, orderBy: { createdAt: "desc" } });
      expect(audit.afterValue).toMatchObject({ items: [{ roundingAdjustment: { confirmedBy: admin.id, adjustmentAmount: -0.01 } }] });
      expect(current.subtotal).toBe(50.63);
      await submitDocument(admin, doc.id);
      await reviewDocument(admin, doc.id, { action: "approve" });
      expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).overrideReason).toBe("");
    } finally { await db.document.delete({ where: { id: doc.id } }); }
  });
});
