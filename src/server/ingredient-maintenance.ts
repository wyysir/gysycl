import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission } from "@/lib/permissions";
import { ApiError, type SessionUser } from "./auth";
import type { Prisma } from "@/generated/prisma/client";

const categoryKey = "ingredient.categories";
type Category = { name: string; active: boolean };

export async function assertCategoryActive(tx: Pick<Prisma.TransactionClient, "systemSetting">, name: string) {
  if (!name) return;
  const setting = await tx.systemSetting.findUnique({ where: { key: categoryKey } });
  if (((setting?.value || []) as Category[]).some(item => item.name === name && !item.active)) throw new ApiError(400, "分类已停用，请选择启用分类");
}

export async function ingredientCategories() {
  const db = await getReadyDb();
  const [setting, materials] = await Promise.all([
    db.systemSetting.findUnique({ where: { key: categoryKey } }),
    db.ingredient.findMany({ select: { category: true } }),
  ]);
  const stored = (setting?.value || []) as Category[];
  const names = [...new Set([...stored.map(item => item.name), ...materials.map(item => item.category)].filter(Boolean))];
  return { categories: names.sort().map(name => ({ name, active: stored.find(item => item.name === name)?.active ?? true, count: materials.filter(item => item.category === name).length })), version: setting?.updatedAt.toISOString() || "" };
}

export async function maintainCategory(user: SessionUser, input: { name: string; previousName?: string; active: boolean; version: string }) {
  if (!hasPermission(user, "master.manage")) throw new ApiError(403, "没有分类维护权限");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    const setting = await tx.systemSetting.findUnique({ where: { key: categoryKey } });
    if ((setting?.updatedAt.toISOString() || "") !== input.version) throw new ApiError(409, "分类已变化，请刷新后重试");
    const materials = await tx.ingredient.findMany({ select: { category: true } });
    const stored = (setting?.value || []) as Category[];
    const names = [...new Set([...stored.map(item => item.name), ...materials.map(item => item.category)].filter(Boolean))];
    if (input.previousName && !names.includes(input.previousName)) throw new ApiError(409, "原分类不存在");
    if (input.name !== input.previousName && names.includes(input.name)) throw new ApiError(409, "分类名称已存在");
    const categories = names.filter(name => name !== input.previousName).map(name => ({ name, active: stored.find(item => item.name === name)?.active ?? true }));
    categories.push({ name: input.name, active: input.active });
    if (setting) {
      const claimed = await tx.systemSetting.updateMany({ where: { key: categoryKey, updatedAt: setting.updatedAt }, data: { value: categories } });
      if (claimed.count !== 1) throw new ApiError(409, "分类已变化，请刷新后重试");
    } else await tx.systemSetting.create({ data: { key: categoryKey, value: categories } });
    if (input.previousName && input.previousName !== input.name) await tx.ingredient.updateMany({ where: { category: input.previousName }, data: { category: input.name, version: { increment: 1 } } });
    await tx.auditLog.create({ data: { userId: user.id, entityType: "ingredientCategory", entityId: input.name, action: "category.updated", beforeValue: { name: input.previousName || "" }, afterValue: input } });
    return { saved: true };
  });
}

export async function bulkMaintainIngredients(user: SessionUser, input: { items: { id: string; version: number }[]; active?: boolean; category?: string }) {
  if (!hasPermission(user, "master.manage")) throw new ApiError(403, "没有原材料维护权限");
  if (!input.items.length || input.items.length > 200 || new Set(input.items.map(item => item.id)).size !== input.items.length) throw new ApiError(400, "请选择1至200条不同材料");
  if (input.active === undefined && input.category === undefined) throw new ApiError(400, "请选择操作");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    if (input.category) {
      const setting = await tx.systemSetting.findUnique({ where: { key: categoryKey } });
      const stored = (setting?.value || []) as Category[];
      if (stored.some(item => item.name === input.category && !item.active)) throw new ApiError(400, "分类已停用");
      if (!stored.some(item => item.name === input.category) && !await tx.ingredient.findFirst({ where: { category: input.category } })) throw new ApiError(400, "请先在分类管理中新增分类");
    }
    for (const item of [...input.items].sort((a, b) => a.id.localeCompare(b.id))) {
      const existing = await tx.ingredient.findUnique({ where: { id: item.id } });
      if (!existing || existing.version !== item.version) throw new ApiError(409, "材料已变化，请刷新后重新选择，整批未保存");
      const changed = await tx.ingredient.updateMany({ where: { id: item.id, version: item.version }, data: { ...(input.active === undefined ? {} : { active: input.active }), ...(input.category === undefined ? {} : { category: input.category }), version: { increment: 1 } } });
      if (changed.count !== 1) throw new ApiError(409, "材料已变化，整批未保存");
      await tx.auditLog.create({ data: { userId: user.id, entityType: "ingredient", entityId: item.id, action: "ingredient.bulkUpdated", beforeValue: { active: existing.active, category: existing.category }, afterValue: { active: input.active ?? existing.active, category: input.category ?? existing.category } } });
    }
    return { updated: input.items.length };
  });
}
