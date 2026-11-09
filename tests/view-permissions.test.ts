import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { createSessionToken, getSessionUser, type SessionUser } from "@/server/auth";
import { documentVisibility, type Permission } from "@/lib/permissions";
import { getDashboard, getAnalytics } from "@/server/analytics";
import { getIngredient, ingredientHistory } from "@/server/ingredients";
import { buildDocumentsWorkbook } from "@/server/excel";
import { getDocumentDetail, listDocuments, reviewDocument, submitDocument, withdrawApproval } from "@/server/document-service";
import { deleteDraft } from "@/server/document-deletion";
import { writeLocalObject, deleteObject } from "@/server/storage";
import { GET as detail, PATCH as save } from "@/app/api/documents/[id]/route";
import { POST as createDocument } from "@/app/api/documents/route";
import { GET as bootstrap } from "@/app/api/bootstrap/route";
import { GET as contracts } from "@/app/api/contracts/route";
import { GET as file } from "@/app/api/files/route";

describe("independent document view permissions", () => {
  const marker = `view-${randomUUID()}`;
  const key = `documents/tests/${marker}.jpg`;
  const base: Permission[] = ["document.create", "document.edit_own", "document.edit_project", "document.submit_project",
    "document.approve", "document.return", "document.withdraw", "document.delete_project", "document.export", "analytics.view"];
  let token = "", userId = "", roleId = "", secondRoleId = "", ingredientId = "", supplierId = "";
  let projects: string[] = [], own = "", other = "", second = "", foreign = "", draft = "", otherDraft = "";
  const request = (path: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost:3000${path}`, {
    method, headers: { Cookie: `delivery_session=${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const readUser = async () => (await getSessionUser(request("/api/bootstrap")))!;
  async function permissions(extra: Permission[] = [], secondExtra: Permission[] = []) {
    const db = await getReadyDb();
    await db.customRole.update({ where: { id: roleId }, data: { permissions: [...base, ...extra] } });
    await db.customRole.update({ where: { id: secondRoleId }, data: { permissions: [...base, ...secondExtra] } });
    return readUser();
  }
  async function workbook(user: SessionUser) {
    const result = await buildDocumentsWorkbook(user, {});
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(result.buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    return book;
  }
  beforeAll(async () => {
    const db = await getReadyDb();
    const admin = await db.user.findFirstOrThrow({ where: { active: true, globalRole: "ADMIN" } });
    for (let n = 0; n < 3; n++) projects.push((await db.project.create({ data: { code: `${marker}-${n}`, name: `${marker}-${n}` } })).id);
    roleId = (await db.customRole.create({ data: { name: marker, permissions: base } })).id;
    secondRoleId = (await db.customRole.create({ data: { name: marker + "-second", permissions: base } })).id;
    userId = (await db.user.create({ data: { employeeNo: marker, name: marker, passwordHash: "test-fixture-no-login",
      memberships: { create: [{ projectId: projects[0], role: "SUBMITTER", customRoleId: roleId },
        { projectId: projects[1], role: "SUBMITTER", customRoleId: secondRoleId }] } } })).id;
    ingredientId = (await db.ingredient.create({ data: { name: marker, normalizedName: marker, unit: "斤" } })).id;
    supplierId = (await db.supplier.create({ data: { name: marker, normalizedName: marker } })).id;
    for (const projectId of projects) await db.contract.create({ data: { projectId, supplierId, ingredientId,
      unit: "斤", unitPrice: 486.27, startsOn: new Date("2020-01-01") } });
    async function document(projectId: string, createdById: string, name: string, status: "DRAFT" | "APPROVED" = "APPROVED") {
      return (await db.document.create({ data: { projectId, createdById, supplierId, docNo: marker + name, docDate: new Date(), status,
        subtotal: 1729.44, taxAmount: 5.5, totalAmount: 1734.94, notes: "私密价格说明 486.27", reviewNote: "私密价格说明 486.27",
        items: { create: { ingredientId, lineNo: 1, name: marker, spec: "斤", unit: "斤", quantity: 2, unitPrice: 864.72, amount: 1729.44, matchStatus: "MATCHED" } },
        checks: { create: { dimension: "合同价", type: "contract_price", severity: "WARNING", title: "合同价核对", detail: "私密价格说明 486.27", expectedValue: 486.27, actualValue: 864.72 } },
        auditLogs: { create: { entityType: "document", entityId: marker, userId: admin.id, action: "ocr.completed", afterValue: { price: 486.27, warnings: ["私密价格说明 486.27"] } } },
        approvals: { create: { reviewerId: admin.id, action: "APPROVE", note: "私密价格说明 486.27" } },
      } })).id;
    }
    own = await document(projects[0], userId, "own"); other = await document(projects[0], admin.id, "other");
    second = await document(projects[1], userId, "second"); foreign = await document(projects[2], admin.id, "foreign");
    draft = await document(projects[0], userId, "draft", "DRAFT"); otherDraft = await document(projects[0], admin.id, "other-draft", "DRAFT");
    await db.documentPage.create({ data: { documentId: own, pageNo: 1, objectKey: key, mime: "image/jpeg", fileName: "test.jpg", sha256: marker, status: "COMPLETED" } });
    await db.documentPage.create({ data: { documentId: other, pageNo: 1, objectKey: key + "-other.jpg", mime: "image/jpeg", fileName: "test.jpg", sha256: marker, status: "COMPLETED" } });
    await writeLocalObject(key, Buffer.from([255, 216, 255, 217]));
    token = await createSessionToken(userId);
  });
  afterAll(async () => {
    const db = await getReadyDb();
    await db.document.deleteMany({ where: { projectId: { in: projects } } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.customRole.deleteMany({ where: { id: { in: [roleId, secondRoleId] } } });
    await db.project.deleteMany({ where: { id: { in: projects } } });
    if (ingredientId) await db.ingredient.delete({ where: { id: ingredientId } });
    if (supplierId) await db.supplier.delete({ where: { id: supplierId } });
    await deleteObject(key);
  });

  it("defaults to own documents and redacts prices from detail, images, history, statistics, contracts and Excel", async () => {
    const user = await permissions();
    const list = await listDocuments(user, { q: marker });
    expect(list.map(row => row.id).sort()).toEqual([own, second, draft].sort());
    expect(list.every(row => row.totalAmount === null)).toBe(true);
    expect(list.every(row => row.previewImageUrl === null)).toBe(true);
    expect(await listDocuments(user, { q: "私密价格说明" })).toEqual([]);
    const result = await detail(request(`/api/documents/${own}`), context(own));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.document).toMatchObject({ subtotal: null, taxAmount: null, totalAmount: null, notes: "", pages: [],
      items: [{ unitPrice: null, amount: null, roundingAdjustment: null, sourcePageNo: null }],
      checks: [{ expectedValue: null, actualValue: null }] });
    expect(JSON.stringify(body)).not.toContain("486.27");
    expect(body.audit[0].detail).toBeNull(); expect(body.approvals[0].note).toBe("");
    expect((await detail(request(`/api/documents/${other}`), context(other))).status).toBe(403);
    expect((await detail(request(`/api/documents/${foreign}`), context(foreign))).status).toBe(403);
    expect((await file(request(`/api/files?key=${key}`))).status).toBe(403);
    expect((await (await contracts(request("/api/contracts"))).json()).contracts).toEqual([]);
    expect((await (await bootstrap(request("/api/bootstrap"))).json()).contracts).toEqual([]);
    expect((await getIngredient(user, ingredientId)).contracts).toEqual([]);
    const history = await ingredientHistory(user, ingredientId, {});
    expect(history.total).toBe(2); expect(history.items.every(row => row.unitPrice === null && row.amount === null)).toBe(true);
    const dashboard = await getDashboard(user);
    expect(dashboard.counters.total).toBe(3); expect(dashboard.counters.monthSpend).toBeNull(); expect(dashboard.trend).toEqual([]); expect(dashboard.projectSpend).toEqual([]);
    const analytics = await getAnalytics(user, {});
    expect(analytics.priceMatrix).toEqual([]); expect(analytics.products).toEqual([]); expect(analytics.supplierSpend).toEqual([]); expect(analytics.projectSpend).toEqual([]);
    const book = await workbook(user);
    expect(book.getWorksheet("单据汇总")!.rowCount).toBe(4);
    expect(book.getWorksheet("单据明细")!.getCell("I2").value).toBe("未授权");
    expect(book.getWorksheet("单据明细")!.getCell("J2").value).toBe("未授权");
    expect(JSON.stringify(book.model)).not.toContain("486.27");
    expect(JSON.stringify(book.model)).not.toContain(marker + "other");
  });

  it("grants unit price, amount and contract price separately, per project; source images require both purchase permissions", async () => {
    let user = await permissions(["document.view_unit_price"], ["document.view_amount"]);
    expect((await listDocuments(user, { q: marker })).every(row => row.previewImageUrl === null)).toBe(true);
    expect((await getDocumentDetail(user, own)).document.items[0]).toMatchObject({ unitPrice: 864.72, amount: null });
    expect((await getDocumentDetail(user, second)).document.items[0]).toMatchObject({ unitPrice: null, amount: 1729.44 });
    expect((await getDashboard(user)).counters.monthSpend).toBe(1734.94);
    expect((await file(request(`/api/files?key=${key}`))).status).toBe(403);
    expect((await contracts(request(`/api/contracts?projectId=${projects[0]}`))).status).toBe(403);
    const book = await workbook(user);
    const rows = book.getWorksheet("单据明细")!;
    let found = false;
    rows.eachRow(row => { if (row.getCell(2).value === marker + "own") { found = true; expect(row.getCell(9).value).toBe(864.72); expect(row.getCell(10).value).toBe("未授权"); } });
    expect(found).toBe(true);
    user = await permissions(["contract.view_price"]);
    expect((await getIngredient(user, ingredientId)).contracts).toHaveLength(1);
    expect((await (await bootstrap(request("/api/bootstrap"))).json()).contracts).toHaveLength(1);
    expect((await (await contracts(request("/api/contracts"))).json()).contracts[0].unitPrice).toBe(486.27);
    expect((await getDocumentDetail(user, own)).document.items[0].unitPrice).toBeNull();
    expect((await detail(request(`/api/documents/${other}`), context(other))).status).toBe(403);
    user = await permissions(["document.view_unit_price", "document.view_amount"]);
    expect((await listDocuments(user, { q: marker })).find(row => row.id === own)?.previewImageUrl).toBe(`/api/files?key=${encodeURIComponent(key)}`);
    expect((await listDocuments(user, { q: marker })).find(row => row.id === draft)?.previewImageUrl).toBeNull();
    const image = await file(request(`/api/files?key=${key}`));
    expect(image.status).toBe(200); expect(image.headers.get("Cache-Control")).toBe("private, no-store");
    await permissions(["document.view_amount"]);
    expect((await file(request(`/api/files?key=${key}`))).status).toBe(403);
  });

  it("viewing colleagues does not grant prices or access to other projects", async () => {
    const user = await permissions(["document.view_others"]);
    expect((await listDocuments(user, { q: marker })).map(row => row.id).sort()).toEqual([own, other, second, draft, otherDraft].sort());
    expect((await getDocumentDetail(user, other)).document.totalAmount).toBeNull();
    expect((await ingredientHistory(user, ingredientId, {})).total).toBe(3);
    expect((await getDashboard(user)).counters.total).toBe(5);
    expect((await workbook(user)).getWorksheet("单据汇总")!.rowCount).toBe(6);
    await expect(getDocumentDetail(user, foreign)).rejects.toMatchObject({ status: 403 });
    // Removing a permission applies to the existing signed-in session.
    await permissions();
    expect((await detail(request(`/api/documents/${other}`), context(other))).status).toBe(403);
  });

  it("searches raw, matched and alias material names without broadening document scope", async () => {
    const db = await getReadyDb();
    const raw = `raw-material-${marker}`, matched = `matched-material-${marker}`, alias = `alias-material-${marker}`;
    await db.documentItem.updateMany({ where: { documentId: { in: [own, other, foreign] } }, data: { rawName: raw, name: matched } });
    await db.ingredientAlias.create({ data: { ingredientId, alias, normalizedAlias: alias } });
    let user = await permissions();
    for (const q of [raw, matched]) expect((await listDocuments(user, { q })).map(row => row.id)).toEqual([own]);
    expect((await listDocuments(user, { q: alias })).map(row => row.id).sort()).toEqual([own, second, draft].sort());
    user = await permissions(["document.view_others"]);
    expect((await listDocuments(user, { q: raw })).map(row => row.id).sort()).toEqual([own, other].sort());
    await expect(listDocuments(user, { q: raw, projectId: projects[2] })).rejects.toMatchObject({ status: 403 });
  });

  it("retains server-owned hidden financial fields when editing and ignores forged client prices", async () => {
    const user = await permissions();
    const current = (await getDocumentDetail(user, draft)).document;
    const response = await save(request(`/api/documents/${draft}`, "PATCH", { version: current.version, projectId: projects[0],
      docDate: current.docDate, supplierId, totalAmount: 999, taxAmount: 999, notes: "forged", items: current.items.map(row => ({
        id: row.id, name: row.name, ingredientId, unit: row.unit, spec: row.spec, quantity: 3, unitPrice: 999, amount: 999,
      })) }), context(draft));
    expect(response.status).toBe(200);
    const result = await response.json(); expect(result.document.totalAmount).toBeNull(); expect(result.previous.items[0].unitPrice).toBeNull();
    expect(JSON.stringify(result)).not.toContain("486.27");
    const saved = await (await getReadyDb()).document.findUniqueOrThrow({ where: { id: draft }, include: { items: true } });
    expect(Number(saved.totalAmount)).toBe(1734.94); expect(Number(saved.taxAmount)).toBe(5.5);
    expect(Number(saved.items[0].unitPrice)).toBe(864.72); expect(Number(saved.items[0].amount)).toBe(1729.44);
    expect(Number(saved.items[0].quantity)).toBe(3); expect(saved.notes).toBe("私密价格说明 486.27");
  });

  it("write permissions cannot bypass the colleague view restriction, including review, withdrawal and image reuse", async () => {
    const user = await permissions();
    const db = await getReadyDb();
    const target = await db.document.findUniqueOrThrow({ where: { id: otherDraft } });
    await expect(deleteDraft(user, otherDraft, target.version)).rejects.toMatchObject({ status: 403 });
    await expect(submitDocument(user, otherDraft)).rejects.toMatchObject({ status: 403 });
    await db.document.update({ where: { id: otherDraft }, data: { status: "PENDING_REVIEW" } });
    await expect(reviewDocument(user, otherDraft, { action: "approve" })).rejects.toMatchObject({ status: 403 });
    await expect(withdrawApproval(user, other, { note: "test" })).rejects.toMatchObject({ status: 403 });
    expect(documentVisibility(user, projects[0]).others).toBe(false);
    const response = await createDocument(request("/api/documents", "POST", { entryMode: "OCR", projectId: projects[0], docDate: "2026-11-02",
      pages: [{ objectKey: key + "-other.jpg", mime: "image/jpeg", fileName: "test.jpg" }] }));
    expect(response.status).toBe(403);
  });

  it("does not disclose foreign-project references through company-wide duplicate and price checks", async () => {
    const user = await permissions(["document.view_others", "document.view_unit_price", "document.view_amount", "contract.view_price"]);
    await (await getReadyDb()).checkResult.create({ data: { documentId: own, type: "duplicate_document", dimension: "重复", severity: "WARNING",
      title: "发现疑似重复单据", detail: `foreign-reference-${foreign}`, actualValue: 486.27 } });
    const result = await getDocumentDetail(user, own);
    expect(result.document.totalAmount).toBe(1734.94);
    expect(result.document.checks.find(row => row.type === "duplicate_document")).toMatchObject({ actualValue: null });
    expect(JSON.stringify(result)).not.toContain(`foreign-reference-${foreign}`);
    expect(JSON.stringify((await workbook(user)).model)).not.toContain(`foreign-reference-${foreign}`);
  });
});
