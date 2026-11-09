import { z } from "zod";
import type { Db } from "@/lib/prisma";
import { ApiError } from "./errors";

export const membershipsSchema = z.array(z.object({
  projectId: z.string().min(1),
  role: z.enum(["SUBMITTER", "SUPERVISOR"]).optional(),
  customRoleId: z.string().min(1).optional(),
}).refine(row=>Boolean(row.role) !== Boolean(row.customRoleId), "必须选择一个内置或自定义角色"))
  .max(100).refine(rows => new Set(rows.map(row => `${row.projectId}:${row.role || "SUBMITTER"}`)).size === rows.length,
  "同一个项目角色不能重复分配");

export function membershipData(rows: z.infer<typeof membershipsSchema>) {
  return rows.map(row=>({projectId:row.projectId, role:row.role || "SUBMITTER" as const, customRoleId:row.customRoleId || null}));
}

export async function validateMemberships(db: Pick<Db, "project" | "customRole">, globalRole: string,
  memberships: z.infer<typeof membershipsSchema>, existing: {projectId: string; role: string; customRoleId?: string | null}[] = []) {
  if (globalRole === "STAFF" && !memberships.length) {
    throw new ApiError(400, "项目员工必须至少分配一个项目点角色");
  }
  const changedMemberships = memberships.filter(row => !existing.some(old => old.projectId === row.projectId && old.role === (row.role || "SUBMITTER") && (old.customRoleId || null) === (row.customRoleId || null)));
  const ids = [...new Set(changedMemberships.map(row => row.projectId))];
  if (ids.length && await db.project.count({where:{id:{in:ids},active:true}}) !== ids.length) {
    throw new ApiError(400, "项目点不存在或已停用");
  }
  const roleIds = [...new Set(changedMemberships.flatMap(row=>row.customRoleId ? [row.customRoleId] : []))];
  if (roleIds.length && await db.customRole.count({where:{id:{in:roleIds},active:true}}) !== roleIds.length) {
    throw new ApiError(400, "自定义角色不存在或已停用");
  }
}
