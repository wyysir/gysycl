import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { recomputeDocumentChecks } from "@/server/checks";
import { reviewDocument, submitDocument } from "@/server/document-service";
import type { SessionUser } from "@/server/auth";

const fixtureIds: string[] = [];
const submitter: SessionUser = {
  id: "usr_site_sh", employeeNo: "site_sh", name: "采购", globalRole: "STAFF",
  memberships: [{ projectId: "prj_sh", projectName: "上海", projectCode: "SH-HQ", roles: ["SUBMITTER"] }],
};
let supervisor: SessionUser;

beforeAll(async () => {
  const db = await getReadyDb();
  const user = await db.user.findUniqueOrThrow({ where: { employeeNo: "supervisor" } });
  supervisor = { id: user.id, employeeNo: user.employeeNo, name: user.name, globalRole: "STAFF",
    memberships: [{ projectId: "prj_sh", projectName: "上海", projectCode: "SH-HQ", roles: ["SUPERVISOR"] }],
  };
});

afterEach(async () => {
  const db = await getReadyDb();
  await db.document.deleteMany({ where: { id: { in: fixtureIds.splice(0) } } });
});

async function document(docNo: string, options: { date?: string; supplierId?: string | null; projectId?: string; amount?: number } = {}) {
  const db = await getReadyDb();
  const amount = options.amount ?? 42;
  const created = await db.document.create({ data: {
    docNo, docDate: new Date(`${options.date ?? "2026-10-20"}T00:00:00+08:00`),
    supplierId: options.supplierId === undefined ? "sup_sh" : options.supplierId,
    projectId: options.projectId ?? "prj_sh", createdById: submitter.id,
    status: "DRAFT", subtotal: 42, totalAmount: amount,
    items: { create: { lineNo: 1, rawName: "青菜", name: "青菜", spec: "散装", unit: "kg",
      quantity: 10, unitPrice: 4.2, amount: 42, ingredientId: "ing_qc", confidence: 1, matchStatus: "MATCHED" } },
  } });
  fixtureIds.push(created.id);
  return created;
}

describe("duplicate supplier document numbers only warn", () => {
  it.each(["2026-10-20", "2026-10-19", "2026-09-01", "2025-01-01"])("warns for the same supplier and number from %s", async (date) => {
    const number = `DUP-${randomUUID()}`;
    await document(number, { date });
    const current = await document(number);
    const checks = await recomputeDocumentChecks(await getReadyDb(), current.id);
    expect(checks.filter(check => check.type === "duplicate_document")).toMatchObject([{ severity: "WARNING", status: "OPEN" }]);
  });

  it("also warns across projects", async () => {
    const number = `DUP-${randomUUID()}`;
    await document(number, { date: "2025-01-01", projectId: "prj_hz" });
    const current = await document(number);
    const checks = await recomputeDocumentChecks(await getReadyDb(), current.id);
    expect(checks.find(check => check.type === "duplicate_document")?.severity).toBe("WARNING");
  });

  it("does not confuse different suppliers or the current document with duplicates", async () => {
    const number = `DUP-${randomUUID()}`;
    await document(number, { supplierId: "sup_hz" });
    const current = await document(number);
    const checks = await recomputeDocumentChecks(await getReadyDb(), current.id);
    expect(checks.some(check => check.type === "duplicate_document")).toBe(false);
  });

  it("does not match empty numbers or unconfirmed suppliers", async () => {
    const db = await getReadyDb();
    await document("");
    const empty = await document("");
    expect((await recomputeDocumentChecks(db, empty.id)).some(check => check.type === "duplicate_document")).toBe(false);
    const number = `DUP-${randomUUID()}`;
    await document(number, { supplierId: null });
    const unconfirmed = await document(number, { supplierId: null });
    expect((await recomputeDocumentChecks(db, unconfirmed.id)).some(check => check.type === "duplicate_document")).toBe(false);
  });

  it("allows submission and ordinary supervisor approval without an override reason", async () => {
    const db = await getReadyDb();
    const number = `DUP-${randomUUID()}`;
    await document(number, { date: "2025-01-01" });
    const current = await document(number);
    expect(await submitDocument(submitter, current.id)).toMatchObject({ status: "PENDING_REVIEW" });
    expect(await db.checkResult.findFirst({ where: { documentId: current.id, type: "duplicate_document" } })).toMatchObject({ severity: "WARNING", status: "OPEN" });
    expect(await reviewDocument(supervisor, current.id, { action: "approve" })).toMatchObject({ status: "APPROVED" });
    expect(await db.approvalRecord.findFirst({ where: { documentId: current.id } })).toMatchObject({ action: "APPROVE", note: "" });
    expect(await db.checkResult.findFirst({ where: { documentId: current.id, type: "duplicate_document" } })).toMatchObject({ severity: "WARNING", status: "RESOLVED" });
  });

  it("allows ordinary approval when only the original total differs", async () => {
    const db = await getReadyDb();
    const current = await document(`TOTAL-${randomUUID()}`, { amount: 0 });
    await submitDocument(submitter, current.id);
    expect(await db.checkResult.findFirst({ where: { documentId: current.id, type: "total_mismatch" } })).toMatchObject({ severity: "WARNING" });
    await expect(reviewDocument(supervisor, current.id, { action: "approve" })).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("still blocks ordinary approval for an independent serious amount error", async () => {
    const db = await getReadyDb();
    const number = `DUP-${randomUUID()}`;
    await document(number, { date: "2025-01-01" });
    const current = await document(number, { amount: 0 });
    await db.document.update({ where: { id: current.id }, data: { subtotal: 0 } });
    await submitDocument(submitter, current.id);
    await expect(reviewDocument(supervisor, current.id, { action: "approve" })).rejects.toMatchObject({ status: 422 });
    expect(await db.document.findUnique({ where: { id: current.id } })).toMatchObject({ status: "PENDING_REVIEW" });
  });
});
