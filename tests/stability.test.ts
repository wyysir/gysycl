import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { getReadyDb } from "@/lib/bootstrap";
import { reviewDocument, saveDocument, submitDocument, withdrawApproval } from "@/server/document-service";
import { env } from "@/lib/config";
import { getAnalytics } from "@/server/analytics";
import { uploadToken, verifyUploadToken } from "@/server/storage";
import { importMasterWorkbook } from "@/server/excel";
import { recomputeDocumentChecks } from "@/server/checks";
import { createSupplierFromDocument } from "@/server/master-commands";
import type { SessionUser } from "@/server/auth";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const site: SessionUser = { id: "usr_site_sh", employeeNo: "site_sh", name: "采购", globalRole: "STAFF", memberships: [{ projectId: "prj_sh", projectName: "上海", projectCode: "SH-HQ", roles: ["SUBMITTER"] }] };

async function draft(status: "DRAFT" | "PENDING_REVIEW" = "DRAFT") {
  const db = await getReadyDb();
  return db.document.create({ data: {
    projectId: "prj_sh", supplierId: "sup_sh", createdById: site.id, status,
    docDate: new Date("2026-10-19T00:00:00+08:00"), subtotal: 42, totalAmount: 42,
    items: { create: { lineNo: 1, rawName: "青菜", name: "青菜", spec: "散装", unit: "kg", quantity: 10, unitPrice: 4.2, amount: 42, ingredientId: "ing_qc", confidence: 1, matchStatus: "MATCHED" } },
  }, include: { items: true } });
}

// Both requests finish their preflight reads before either writes.
async function synchronizeTransactions() {
  const db = await getReadyDb();
  const original = db.$transaction.bind(db);
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(db, "$transaction").mockImplementation((async (...args: unknown[]) => {
    arrivals += 1;
    if (arrivals <= 2) {
      if (arrivals === 2) release();
      await barrier;
    }
    return Reflect.apply(original, db, args);
  }) as typeof db.$transaction);
}

function oneSuccessOneConflict(results: PromiseSettledResult<unknown>[]) {
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ status: 409 });
}

beforeAll(async () => { await getReadyDb(); });
afterEach(() => vi.restoreAllMocks());

describe("concurrent document mutations", () => {
  it("does not let a save invalidate an active OCR task and leave it stuck", async () => {
    const db = await getReadyDb();
    const document = await draft();
    await db.document.update({ where: { id: document.id }, data: { status: "PROCESSING" } });
    await expect(saveDocument(site, document.id, { version: document.version, projectId: "prj_sh", docDate: "2026-10-19", items: [], totalAmount: 0 })).rejects.toMatchObject({ status: 409 });
    expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).version).toBe(document.version);
    expect(await db.documentItem.count({ where: { documentId: document.id } })).toBe(1);
  });
  it("does not bind a new supplier while OCR is still processing", async () => {
    const db = await getReadyDb();
    const document = await draft();
    await db.document.update({ where: { id: document.id }, data: { status: "PROCESSING" } });
    const name = `processing supplier ${document.id}`;
    await expect(createSupplierFromDocument(admin, { name, sourceDocumentId: document.id })).rejects.toMatchObject({ status: 409 });
    expect(await db.supplier.count({ where: { name } })).toBe(0);
  });
  it("revalidates the current data before approving even when old checks are missing", async () => {
    const db = await getReadyDb();
    const document = await draft("PENDING_REVIEW");
    await db.document.update({ where: { id: document.id }, data: { subtotal: 0 } });
    await expect(reviewDocument(admin, document.id, { action: "approve" })).rejects.toMatchObject({ status: 422 });
    expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).status).toBe("PENDING_REVIEW");
    expect(await db.approvalRecord.count({ where: { documentId: document.id } })).toBe(0);
  });
  it("does not reopen resolved historical checks when an old recheck reaches an approved document", async () => {
    const db = await getReadyDb();
    const document = await draft("PENDING_REVIEW");
    await reviewDocument(admin, document.id, { action: "approve", override: true, note: "test" });
    const before = await db.checkResult.findMany({ where: { documentId: document.id }, orderBy: { id: "asc" } });
    await recomputeDocumentChecks(db, document.id);
    expect(await db.checkResult.findMany({ where: { documentId: document.id }, orderBy: { id: "asc" } })).toEqual(before);
  });
  it("rolls back new supplier creation when the source document is approved concurrently", async () => {
    const db = await getReadyDb();
    const document = await draft("PENDING_REVIEW");
    const original = db.$transaction.bind(db);
    let intercepted = false;
    vi.spyOn(db, "$transaction").mockImplementation((async (...args: unknown[]) => {
      if (!intercepted) {
        intercepted = true;
        await db.document.update({ where: { id: document.id }, data: { status: "APPROVED", version: { increment: 1 } } });
      }
      return Reflect.apply(original, db, args);
    }) as typeof db.$transaction);
    const name = `race supplier ${document.id}`;
    await expect(createSupplierFromDocument(admin, { name, sourceDocumentId: document.id })).rejects.toMatchObject({ status: 409 });
    expect(await db.supplier.count({ where: { name } })).toBe(0);
    expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).supplierId).toBe("sup_sh");
  });
  it("only records one decision when approval and return race", async () => {
    const db = await getReadyDb();
    const document = await draft("PENDING_REVIEW");
    await synchronizeTransactions();
    oneSuccessOneConflict(await Promise.allSettled([
      reviewDocument(admin, document.id, { action: "approve" }),
      reviewDocument(admin, document.id, { action: "return", note: "并发退回" }),
    ]));
    expect(await db.approvalRecord.count({ where: { documentId: document.id } })).toBe(1);
  });

  it("submits once, records one audit and creates no notifications", async () => {
    const db = await getReadyDb();
    const document = await draft();
    await synchronizeTransactions();
    oneSuccessOneConflict(await Promise.allSettled([
      submitDocument(site, document.id), submitDocument(site, document.id),
    ]));
    expect(await db.auditLog.count({ where: { documentId: document.id, action: "document.submitted" } })).toBe(1);
    expect(await db.notification.count({ where: { documentId: document.id } })).toBe(0);
  });

  it("completes submission, return, approval and withdrawal without WeChat notification calls", async () => {
    const db = await getReadyDb();
    const document = await draft();
    const previousAppId = env.WECHAT_APP_ID;
    const previousSecret = env.WECHAT_APP_SECRET;
    env.WECHAT_APP_ID = "test-wechat-app-id";
    env.WECHAT_APP_SECRET = "test-wechat-app-secret";
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External calls must not be needed for document review"));
    try {
      expect(await submitDocument(site, document.id)).toMatchObject({ status: "PENDING_REVIEW" });
      expect(await reviewDocument(admin, document.id, { action: "return", note: "补充资料" })).toMatchObject({ status: "NEEDS_REVISION" });
      expect(await submitDocument(site, document.id)).toMatchObject({ status: "PENDING_REVIEW" });
      expect(await reviewDocument(admin, document.id, { action: "approve", override: true, note: "已核实" })).toMatchObject({ status: "APPROVED" });
      expect(await withdrawApproval(admin, document.id, { note: "重新核对" })).toMatchObject({ status: "PENDING_REVIEW" });
      expect(await db.notification.count({ where: { documentId: document.id } })).toBe(0);
      expect(await db.approvalRecord.count({ where: { documentId: document.id } })).toBe(2);
      expect(await db.auditLog.count({ where: { documentId: document.id, action: { in: ["document.submitted", "review.returned", "review.approved", "review.withdrawn"] } } })).toBe(5);
      expect(request).not.toHaveBeenCalled();
    } finally {
      env.WECHAT_APP_ID = previousAppId;
      env.WECHAT_APP_SECRET = previousSecret;
    }
  });

  it("returns a business conflict for simultaneous saves and preserves the winning items", async () => {
    const db = await getReadyDb();
    const document = await draft();
    const input = { version: document.version, projectId: "prj_sh", docDate: "2026-10-19", supplierId: "sup_sh", totalAmount: 42,
      items: [{ name: "青菜", spec: "散装", unit: "kg", quantity: 10, unitPrice: 4.2, amount: 42, ingredientId: "ing_qc", confidence: 1 }] };
    await synchronizeTransactions();
    oneSuccessOneConflict(await Promise.allSettled([
      saveDocument(site, document.id, { ...input, notes: "A" }),
      saveDocument(site, document.id, { ...input, notes: "B" }),
    ]));
    expect(await db.documentItem.count({ where: { documentId: document.id } })).toBe(1);
  });
});

describe("invalid inputs", () => {
  it("rejects overflowing line calculations without deleting the existing items", async () => {
    const db = await getReadyDb();
    const document = await draft();
    await expect(saveDocument(site, document.id, {
      version: document.version, projectId: "prj_sh", docDate: "2026-10-19", supplierId: "sup_sh", totalAmount: 42,
      items: [{ name: "青菜", unit: "kg", quantity: 1e9, unitPrice: 1e9, amount: 42, ingredientId: "ing_qc" }],
    })).rejects.toMatchObject({ status: 400 });
    expect(await db.documentItem.count({ where: { documentId: document.id } })).toBe(1);
    expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).version).toBe(document.version);
  });
  it("reports a forbidden analytics project as 403", async () => {
    await expect(getAnalytics(site, { projectId: "prj_hz" })).rejects.toMatchObject({ status: 403 });
  });
  it("rejects invalid analytics dates and reversed intervals", async () => {
    for (const filters of [{ from: "2026-02-30" }, { to: "not-a-date" }, { from: "2026-10-28", to: "2026-10-01" }]) {
      await expect(getAnalytics(admin, filters)).rejects.toMatchObject({ status: 400 });
    }
  });
  it("rejects a multibyte upload signature without throwing", () => {
    const expires = Date.now() + 60_000;
    const token = uploadToken("documents/test.png", "image/png", expires);
    expect(verifyUploadToken("documents/test.png", "image/png", expires, "汉".repeat(token.length))).toBe(false);
    expect(verifyUploadToken("documents/test.png", "image/png", expires, token)).toBe(true);
  });
  it("rejects invalid contract end dates and non-finite prices before Excel import", async () => {
    for (const [price, end] of [[8.5, "2026-02-30"], ["Infinity", "2026-12-31"]]) {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet("供应商").addRow(["名称"]);
      workbook.addWorksheet("原材料").addRow(["品名", "规格", "单位"]);
      workbook.addWorksheet("项目合同价").addRows([
        ["项目点编码", "供应商名称", "品名", "规格", "单位", "单价", "生效日期", "截止日期"],
        ["SH-HQ", "上海鲜禾农副产品有限公司", "青菜", "散装", "kg", price, "2026-01-01", end],
      ]);
      const result = await importMasterWorkbook(admin, Buffer.from(await workbook.xlsx.writeBuffer()), true);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.summary).toBeNull();
    }
  });
});
