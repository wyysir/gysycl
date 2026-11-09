import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getReadyDb } from "@/lib/bootstrap";
import { listFeedback, submitFeedback } from "@/server/feedback";
import { frequentMaterials } from "@/server/frequent-materials";
import { createManualDocument } from "@/server/documents";
import type { SessionUser } from "@/server/auth";
const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const staff: SessionUser = { id: "usr_site_sh", employeeNo: "site_sh", name: "采购", globalRole: "STAFF", memberships: [{ projectId: "prj_sh", projectName: "上海", projectCode: "SH-HQ", roles: ["SUBMITTER"] }] };
describe("feedback visibility and frequent materials", () => {
  it("persists feedback and limits staff to their own records", async () => {
    const own = await submitFeedback(staff, { content: `建议${randomUUID()}`, contact: "店内联系" });
    const other = await submitFeedback(admin, { content: "管理员建议", contact: "" });
    const result = await listFeedback(staff);
    expect(result.canViewAll).toBe(false);
    expect(result.items.some(item => item.id === own.id && item.contact === "店内联系")).toBe(true);
    expect(result.items.some(item => item.id === other.id)).toBe(false);
    expect((await listFeedback(admin)).items.some(item => item.id === other.id)).toBe(true);
  });
  it("counts only accessible documents, excludes inactive ingredients, and orders by usage", async () => {
    const db = await getReadyDb();
    const project = await db.project.create({data: {code: `frequent-${randomUUID()}`, name: "常用材料独立回归"}});
    const scoped: SessionUser = {...staff, memberships: [{projectId: project.id, projectName: project.name, projectCode: project.code, roles: ["SUBMITTER"]}]};
    const materials = await Promise.all([0, 1, 2].map(index => db.ingredient.create({ data: { name: `常用${index}-${randomUUID()}`, normalizedName: randomUUID(), unit: "斤", active: index !== 2 } })));
    const document = await createManualDocument({ userId: staff.id, projectId: project.id, docDate: new Date() });
    try {
      for (let index = 0; index < 4; index++) await db.documentItem.create({ data: { documentId: document.id, lineNo: index + 1, name: "材料", unit: "斤", quantity: 1, unitPrice: 1, amount: 1, ingredientId: materials[index < 2 ? 0 : index - 1].id } });
      const rows = await frequentMaterials(scoped);
      expect(rows.map(item => item.id)).toEqual([materials[0].id, materials[1].id]);
      expect(rows.some(item => item.id === materials[2].id)).toBe(false);
      expect(await frequentMaterials({ ...scoped, memberships: [] })).toEqual([]);
    } finally {
      await db.auditLog.deleteMany({where: {documentId: document.id}});
      await db.document.delete({where: {id: document.id}});
      await db.ingredient.deleteMany({where: {id: {in: materials.map(item => item.id)}}});
      await db.project.delete({where: {id: project.id}});
    }
  });
});
