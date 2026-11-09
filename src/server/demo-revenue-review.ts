import type { Db } from "@/lib/prisma";
import { demoWeekBatch } from "./demo-week";

// Upgrade only unchanged, explicitly synthetic past-day samples. No date-wide or project-wide approvals.
export async function markDemoRevenueReviewed(db: Db, apply = false) {
  return db.$transaction(async tx => {
    const seeds = await tx.auditLog.findMany({ where: { action: "demo.revenue.seeded", entityType: "projectDailyRevenue", entityId: { startsWith: "demo_week_20261102_" } } });
    const author = await tx.user.findFirstOrThrow({ where: { active: true, globalRole: "ADMIN" }, orderBy: { createdAt: "asc" } });
    const eligible: string[] = [], skipped: string[] = [];
    for (const seed of seeds) {
      const original = seed.afterValue as { batch?: string; synthetic?: boolean; projectId?: string; date?: string; amount?: number } | null;
      if (!original || original.batch !== demoWeekBatch || original.synthetic !== true || !original.date || original.date >= "2026-11-02") continue;
      const before = await tx.projectDailyRevenue.findUnique({ where: { id: seed.entityId } });
      const note = `【虚构演示数据】${demoWeekBatch}；无真实交易、无原图；由脚本生成已通过状态，不代表人工审批。`;
      if (!before || before.status !== "PENDING_REVIEW" || before.reviewedById || before.reviewNote || before.projectId !== original.projectId
        || before.date.toISOString().slice(0, 10) !== original.date || Number(before.amount) !== original.amount || before.notes !== note
        || await tx.auditLog.count({ where: { entityId: seed.entityId, action: { in: ["revenue.approved", "revenue.returned", "demo.revenue.reviewed"] } } })) {
        skipped.push(seed.entityId); continue;
      }
      eligible.push(before.id);
      if (!apply) continue;
      const after = await tx.projectDailyRevenue.update({ where: { id: before.id, version: before.version }, data: {
        status: "APPROVED", reviewedById: author.id, reviewedAt: new Date(), reviewNote: "【虚构演示数据】旧样例补齐通过状态，仅用于图表展示，不代表人工审批", version: { increment: 1 },
      } });
      await tx.auditLog.create({ data: { entityType: "projectDailyRevenue", entityId: after.id, userId: author.id, action: "demo.revenue.reviewed",
        beforeValue: JSON.parse(JSON.stringify(before)), afterValue: { ...JSON.parse(JSON.stringify(after)), synthetic: true, batch: demoWeekBatch } } });
    }
    return { apply, synthetic: true, eligible, skipped };
  });
}
