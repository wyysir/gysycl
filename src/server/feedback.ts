import { randomUUID } from "node:crypto";
import { getReadyDb } from "@/lib/bootstrap";
import type { SessionUser } from "./auth";

export async function submitFeedback(user: SessionUser, input: { content: string; contact: string }) {
  const db = await getReadyDb();
  const row = await db.auditLog.create({ data: { entityType: "feedback", entityId: randomUUID(), userId: user.id, action: "feedback.submitted", afterValue: input } });
  return { id: row.id };
}
export async function listFeedback(user: SessionUser) {
  const db = await getReadyDb();
  const canViewAll = user.globalRole === "ADMIN";
  const rows = await db.auditLog.findMany({ where: { entityType: "feedback", action: "feedback.submitted", ...(canViewAll ? {} : { userId: user.id }) }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { name: true } } } });
  return { canViewAll, items: rows.map(row => ({ id: row.id, createdAt: row.createdAt.toISOString(), author: row.user?.name || "", ...(row.afterValue as { content: string; contact: string }) })) };
}
