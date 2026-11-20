import { measurementDto, measurementInclude } from "./measurements";
import { createMaterialCatalogue } from "./material-catalogue";
import { choiceUnit } from "@/lib/material-choice";
import { assertCategoryActive } from "./ingredient-maintenance";
import { hasPermission, permissionProjectIds } from "@/lib/permissions";
import type { Prisma } from "@/generated/prisma/client";
import { documentReadScope } from "./read-scope";
import { getReadyDb } from "@/lib/bootstrap";
import {
  normalizeName, normalizeSpecification, productSpecification,
  normalizeUnit,
  dateOnly,
  parseDateOnly,
} from "@/lib/text";
import { allowedProjectIds, ApiError, isAdmin, type SessionUser } from "./auth";

export function ingredientDto(
  item: Prisma.IngredientGetPayload<{
    include: {
      aliases: true;
      productSpecification: { include: { material: true } };
      _count: { select: { items: true; contracts: true } };
    };
  }>,
) {
  return {
    id: item.id,
    measurement: measurementDto(item),
    specificationKey: normalizeSpecification(productSpecification(item.spec, item.unit)),
    name: item.name,
    spec: item.spec,
    unit: item.unit,
    category: item.category,
    notes: item.notes,
    active: item.active,
    version: item.version,
    aliases: item.aliases.map((alias) => alias.alias),
    referenced: item._count.items > 0 || item._count.contracts > 0,
    legacySpec: normalizeSpecification(item.spec) !== normalizeName(item.unit),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
const include = {
  ...measurementInclude,
  aliases: true,
  _count: { select: { items: true, contracts: true } },
} as const;
function paging(page: unknown) {
  const value = Number(page ?? 1);
  if (!Number.isInteger(value) || value < 1 || value > 100000)
    throw new ApiError(400, "页码无效");
  return value;
}
export async function listIngredients(
  user: SessionUser,
  filters: {
    q?: string;
    unit?: string;
    unitScope?: string;
    category?: string;
    status?: string;
    page?: unknown;
  },
) {
  const db = await getReadyDb();
  const page = paging(filters.page);
  const q = filters.q?.trim() || "";
  if (filters.status && !["active", "inactive", "all"].includes(filters.status))
    throw new ApiError(400, "材料状态无效");
  if (filters.status && filters.status !== "active" && !hasPermission(user,"master.manage"))
    throw new ApiError(403, "只有管理员可以查看停用材料");
  const normalized = normalizeName(q);
  if (filters.unitScope && !["all", "multi", "multi_pending"].includes(filters.unitScope)) throw new ApiError(400, "单位维护筛选无效");
  let multipleIds: string[] | null = null;
  if (filters.unitScope && filters.unitScope !== "all") {
    const catalogue = await createMaterialCatalogue(db);
    multipleIds = [...catalogue.groups.values()].filter(g => new Set(g.options.map(o => choiceUnit(o.unit))).size > 1).flatMap(g => g.options.map(o => o.id));
  }
  const where: Prisma.IngredientWhereInput = {
    ...(multipleIds ? { id: { in: multipleIds } } : {}),
    ...(filters.unitScope === "multi_pending" ? { AND: [{ OR: [{ productSpecificationId: null }, { quantityPerProductUnit: null },
      { productSpecification: { is: { OR: [{ baseUnit: "" }, { baseQuantity: null }, { material: { baseUnit: "" } }] } } }] }] } : {}),
    ...(filters.status === "all"
      ? {}
      : { active: filters.status !== "inactive" }),
    ...(filters.unit ? { unit: normalizeUnit(filters.unit) } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(q && normalized
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { normalizedName: { contains: normalized } },
            {
              aliases: { some: { normalizedAlias: { contains: normalized } } },
            },
            { unit: { equals: normalizeUnit(q) } },
          ],
        }
      : {}),
  };
  const [items, total, facets] = await Promise.all([
    db.ingredient.findMany({
      where,
      include,
      orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
      skip: (page - 1) * 20,
      take: 20,
    }),
    db.ingredient.count({ where }),
    db.ingredient.findMany({
      where: hasPermission(user,"master.manage") ? {} : { active: true },
      select: { unit: true, category: true },
    }),
  ]);
  return {
    items: items.map(ingredientDto),
    total,
    page,
    pageSize: 20,
    units: [...new Set(facets.map((item) => item.unit))].sort(),
    categories: [
      ...new Set(facets.map((item) => item.category).filter(Boolean)),
    ].sort(),
  };
}
export async function getIngredient(user: SessionUser, id: string) {
  const db = await getReadyDb();
  const item = await db.ingredient.findUnique({ where: { id }, include });
  if (!item) throw new ApiError(404, "原材料不存在");
  const projects = permissionProjectIds(user,"contract.view_price");
  const contracts = await db.contract.findMany({
    where: {
      ingredientId: id,
      ...(projects ? { projectId: { in: projects } } : {}),
    },
    include: { project: true, supplier: true },
    orderBy: [{ startsOn: "desc" }, { id: "asc" }],
  });
  return {
    ingredient: ingredientDto(item),
    contracts: contracts.map((contract) => ({
      id: contract.id,
      projectName: contract.project.name,
      supplierName: contract.supplier.name,
      spec: contract.spec,
      unit: contract.unit,
      unitPrice: Number(contract.unitPrice),
      startsOn: dateOnly(contract.startsOn),
      endsOn: contract.endsOn ? dateOnly(contract.endsOn) : null,
    })),
  };
}
export async function ingredientHistory(
  user: SessionUser,
  id: string,
  filters: {
    page?: unknown;
    from?: string;
    to?: string;
    projectId?: string;
    supplierId?: string;
    analyticsScope?: boolean;
    unit?: string;
    spec?: string;
  },
) {
  const db = await getReadyDb();
  const page = paging(filters.page);
  if (
    !(await db.ingredient.findUnique({ where: { id }, select: { id: true } }))
  )
    throw new ApiError(404, "原材料不存在");
  const readableProjects = allowedProjectIds(user);
  if (filters.analyticsScope && !hasPermission(user,"analytics.view")) throw new ApiError(403,"没有分析权限");
  const analysisProjects = filters.analyticsScope ? permissionProjectIds(user,"analytics.view") : null;
  const projects = readableProjects && analysisProjects ? readableProjects.filter(id => analysisProjects.includes(id)) : analysisProjects || readableProjects;
  if (filters.projectId && projects && !projects.includes(filters.projectId))
    throw new ApiError(403, "无权查看该项目点");
  const from = filters.from ? parseDateOnly(filters.from) : null,
    to = filters.to ? parseDateOnly(filters.to) : null;
  if (
    (filters.from && !from) ||
    (filters.to && !to) ||
    (from && to && from > to)
  )
    throw new ApiError(400, "日期区间无效");
  const where: Prisma.DocumentItemWhereInput = {
    ingredientId: id,
    ...(filters.spec !== undefined ? { spec: filters.spec } : {}),
    ...(filters.unit ? { unit: normalizeUnit(filters.unit) } : {}),
    document: {
      AND:[documentReadScope(user)],
      status: "APPROVED",
      ...(projects ? { projectId: { in: projects } } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(from || to
        ? {
            docDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: new Date(to.getTime() + 86400000) } : {}),
            },
          }
        : {}),
    },
  };
  const [items, total] = await Promise.all([
    db.documentItem.findMany({
      where,
      include: { document: { include: { project: true, supplier: true } } },
      orderBy: [{ document: { docDate: "desc" } }, { id: "asc" }],
      skip: (page - 1) * 20,
      take: 20,
    }),
    db.documentItem.count({ where }),
  ]);
  return {
    total,
    page,
    pageSize: 20,
    items: items.map((item) => ({
      id: item.id,
      documentId: item.documentId,
      docNo: item.document.docNo,
      docDate: dateOnly(item.document.docDate),
      projectName: item.document.project.name,
      supplierName:
        item.document.supplier?.name || item.document.ocrSupplierName,
      name: item.name,
      spec: item.spec,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: hasPermission(user,"document.view_unit_price",item.document.projectId)?Number(item.unitPrice):null,
      amount: hasPermission(user,"document.view_amount",item.document.projectId)?Number(item.amount):null,
    })),
  };
}
export type IngredientUpdate = {
  version: number;
  name: string;
  unit: string;
  spec?: string;
  category: string;
  aliases: string[];
  notes: string;
  active: boolean;
};
export async function updateIngredient(
  user: SessionUser,
  id: string,
  input: IngredientUpdate,
) {
  if (!hasPermission(user,"master.manage")) throw new ApiError(403, "只有管理员可以维护原材料");
  const db = await getReadyDb();
  const unit = normalizeUnit(input.unit),
    name = input.name.trim(),
    normalizedName = normalizeName(name);
  if (!normalizedName || !unit) throw new ApiError(400, "品名和单位不能为空");
  const aliases = [
    ...new Map(
      input.aliases.map((alias) => [normalizeName(alias), alias.trim()]),
    ).entries(),
  ].filter(([key]) => key && key !== normalizedName);
  return db.$transaction(async (tx) => {
    const existing = await tx.ingredient.findUnique({ where: { id }, include });
    if (!existing) throw new ApiError(404, "原材料不存在");
    if (input.category.trim() !== existing.category) await assertCategoryActive(tx, input.category.trim());
    if (existing.version !== input.version)
      throw new ApiError(409, "材料已被修改，请刷新后重试");
    const claimed = await tx.ingredient.updateMany({
      where: { id, version: input.version },
      data: { version: { increment: 1 } },
    });
    if (claimed.count !== 1)
      throw new ApiError(409, "材料已被修改，请刷新后重试");
    // Only change the material's current metadata. Contracts and document
    // items retain their own spec/unit/price snapshots, even when referenced.
    const rawSpec = input.spec?.trim();
    const spec = rawSpec === undefined ? productSpecification(existing.spec, existing.unit) : productSpecification(rawSpec, unit);
    const identityChanged = normalizeSpecification(spec) !== normalizeSpecification(productSpecification(existing.spec, existing.unit)) || normalizedName !== existing.normalizedName;
    const duplicate = await tx.ingredient.findFirst({
      where: {
        id: { not: id },
        normalizedName,
        unit,
        normalizedSpec: normalizeSpecification(productSpecification(spec, unit)),
      },
    });
    if (duplicate)
      throw new ApiError(409, "相同品名、规格和单位的材料已存在，请复用或合并");
    await tx.ingredientAlias.deleteMany({ where: { ingredientId: id } });
    const updated = await tx.ingredient.update({
      where: { id },
      data: {
        name,
        normalizedName,
        unit,
        spec,
        normalizedSpec: normalizeSpecification(productSpecification(spec, unit)),
        ...(identityChanged ? { productSpecificationId: null, quantityPerProductUnit: null } : unit !== existing.unit ? { quantityPerProductUnit: null } : {}),
        category: input.category.trim(),
        notes: input.notes.trim(),
        active: input.active,
        aliases: {
          create: aliases.map(([normalizedAlias, alias]) => ({
            alias,
            normalizedAlias,
          })),
        },
      },
      include,
    });
    await tx.auditLog.create({
      data: {
        entityType: "ingredient",
        entityId: id,
        userId: user.id,
        action: "ingredient.updated",
        beforeValue: ingredientDto(existing),
        afterValue: ingredientDto(updated),
      },
    });
    return { ingredient: ingredientDto(updated) };
  });
}
