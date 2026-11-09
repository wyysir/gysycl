import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { createSessionToken, getSessionUser, authenticate } from "@/server/auth";
import { hashPassword } from "@/lib/passwords";
import { DELETE, PATCH } from "@/app/api/users/[id]/route";
import { GET, POST } from "@/app/api/users/route";

describe("employee account deletion preserves business history", () => {
  const marker = `delete-${randomUUID()}`;
  let adminId = "", employeeId = "", projectId = "", documentId = "", adminToken = "", employeeToken = "";
  const request = (token: string, method = "DELETE", body?: unknown) => new NextRequest("http://localhost:3000/api/users/test", {
    method, headers: { Cookie: `delivery_session=${token}`, Origin: "http://localhost:3000", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  beforeAll(async () => {
    const db = await getReadyDb();
    adminId = (await db.user.findFirstOrThrow({ where: { globalRole: "ADMIN", active: true, deletedAt: null } })).id;
    employeeId = (await db.user.create({ data: { employeeNo: marker, name: marker, passwordHash: hashPassword("fixture-password") } })).id;
    projectId = (await db.project.create({ data: { code: marker, name: marker } })).id;
    await db.projectMembership.create({ data: { projectId, userId: employeeId, role: "SUBMITTER" } });
    documentId = (await db.document.create({ data: { projectId, createdById: employeeId, docNo: marker, docDate: new Date(), status: "APPROVED" } })).id;
    adminToken = await createSessionToken(adminId); employeeToken = await createSessionToken(employeeId);
  });
  afterAll(async () => {
    const db = await getReadyDb();
    await db.auditLog.deleteMany({ where: { entityType: "user", entityId: employeeId } });
    if (documentId) await db.document.delete({ where: { id: documentId } });
    if (employeeId) await db.user.delete({ where: { id: employeeId } });
    if (projectId) await db.project.delete({ where: { id: projectId } });
  });
  it("rejects anonymous requests, non-admins, self deletion and foreign origins", async () => {
    expect((await DELETE(request(""), context(employeeId))).status).toBe(401);
    expect((await DELETE(request(employeeToken), context(adminId))).status).toBe(403);
    expect((await DELETE(request(adminToken), context(adminId))).status).toBe(400);
    const foreign = new NextRequest("http://localhost:3000/api/users/test", { method: "DELETE", headers: { Cookie: `delivery_session=${adminToken}`, Origin: "https://foreign.invalid" } });
    expect((await DELETE(foreign, context(employeeId))).status).toBe(403);
  });
  it("removes login/list access, keeps attribution and audit, rejects reactivation and employee number reuse", async () => {
    const db = await getReadyDb(); const before = await db.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(await authenticate(marker, "fixture-password")).not.toBeNull();
    expect((await DELETE(request(adminToken), context(employeeId))).status).toBe(200);
    const account = await db.user.findUniqueOrThrow({ where: { id: employeeId } });
    expect(account.active).toBe(false); expect(account.deletedAt).not.toBeNull();
    expect(await db.document.findUniqueOrThrow({ where: { id: documentId } })).toEqual(before);
    expect(await getSessionUser(request(employeeToken, "GET"))).toBeNull();
    expect(await authenticate(marker, "fixture-password")).toBeNull();
    const listing = await (await GET(request(adminToken, "GET"))).json();
    expect(listing.users.some((u: { id: string }) => u.id === employeeId)).toBe(false);
    expect((await PATCH(request(adminToken, "PATCH", { active: true }), context(employeeId))).status).toBe(404);
    expect((await DELETE(request(adminToken), context(employeeId))).status).toBe(404);
    expect((await POST(request(adminToken, "POST", { employeeNo: marker, name: marker, password: "fixture-password" }))).status).toBe(409);
    expect(await db.auditLog.count({ where: { entityId: employeeId, action: "user.deleted" } })).toBe(1);
  });
});
