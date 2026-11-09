import { expect, it, vi } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { createManualDocument } from "@/server/documents";
import { saveDocument, submitDocument, reviewDocument } from "@/server/document-service";
import type { SessionUser } from "@/server/auth";

it("creates a manual draft without OCR, preserves its generated number, and supports approval without images", async () => {
  const db = await getReadyDb();
  const user: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const created = await createManualDocument({ userId: user.id, projectId: "prj_sh", docDate: new Date("2026-10-30") });
  try {
    expect(created.status).toBe("DRAFT");
    expect(created.docNo).toMatch(/^SHD-\d{8}-[A-F0-9]{32}$/);
    expect(await db.documentPage.count({ where: { documentId: created.id } })).toBe(0);
    await expect(submitDocument(user, created.id)).rejects.toThrow("供应商");
    await saveDocument(user, created.id, {
      version: created.version, docNo: "client-cannot-change-number", projectId: "prj_sh", docDate: "2026-10-30", supplierId: "sup_sh", totalAmount: 42,
      items: [{ name: "青菜", spec: "散装", unit: "kg", quantity: 10, unitPrice: 4.2, amount: 42, ingredientId: "ing_qc", confidence: 1 }],
    });
    expect((await db.document.findUniqueOrThrow({ where: { id: created.id } })).docNo).toBe(created.docNo);
    expect((await submitDocument(user, created.id)).status).toBe("PENDING_REVIEW");
    await reviewDocument(user, created.id, { action: "approve" });
    expect((await db.document.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("APPROVED");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
    await db.document.delete({ where: { id: created.id } });
  }
});
import { createIngredientFromDocument } from "@/server/master-commands";

it("creates a material for an unsaved row in an empty manual draft, then persists its association", async () => {
  const db = await getReadyDb();
  const user: SessionUser = { id: "usr_site_sh", employeeNo: "site_sh", name: "采购", globalRole: "STAFF", memberships: [{ projectId: "prj_sh", projectName: "上海", projectCode: "SH-HQ", roles: ["SUBMITTER"] }] };
  const doc = await createManualDocument({ userId: user.id, projectId: "prj_sh", docDate: new Date("2026-10-30") });
  let ingredientId: string | undefined;
  try {
    expect(await db.documentItem.count({ where: { documentId: doc.id } })).toBe(0);
    const material = await createIngredientFromDocument(user, { name: `手工新材料-${doc.id}`, unit: "斤", sourceDocumentId: doc.id });
    ingredientId = material.id;
    expect(await db.documentItem.count({ where: { documentId: doc.id } })).toBe(0);
    await saveDocument(user, doc.id, { version: doc.version, docDate: "2026-10-30", projectId: "prj_sh", supplierId: "sup_sh", totalAmount: 15,
      items: [{ id: "new-temporary", name: material.name, unit: material.unit, spec: material.spec, quantity: 3, unitPrice: 5, amount: 15, ingredientId: material.id, confidence: 1 }],
    });
    expect(await db.documentItem.findFirst({ where: { documentId: doc.id } })).toMatchObject({ ingredientId: material.id, name: material.name, matchStatus: "MATCHED" });
    expect((await submitDocument(user, doc.id)).status).toBe("PENDING_REVIEW");
  } finally {
    await db.document.delete({ where: { id: doc.id } });
    if (ingredientId) await db.ingredient.delete({ where: { id: ingredientId } });
  }
});
