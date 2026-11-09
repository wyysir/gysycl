import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission } from "@/lib/permissions";
import { normalizeName, parseDateOnly } from "@/lib/text";
import { ApiError, type SessionUser } from "./auth";

export type SupplierUpdate = {
  updatedAt: string;
  name: string;
  contactName: string;
  contactPhone: string;
  aliases: string[];
  active: boolean;
};

export async function updateSupplier(user: SessionUser, id: string, input: SupplierUpdate) {
  if (!hasPermission(user, "master.manage")) throw new ApiError(403, "没有供应商维护权限");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    const existing = await tx.supplier.findUnique({ where: { id }, include: { aliases: true } });
    if (!existing) throw new ApiError(404, "供应商不存在");
    if (existing.updatedAt.toISOString() !== input.updatedAt) throw new ApiError(409, "供应商已被修改，请刷新后重试");
    const name = input.name.trim(), normalizedName = normalizeName(name);
    if (!normalizedName) throw new ApiError(400, "供应商名称不能为空");
    const names = [...input.aliases, ...(normalizedName !== existing.normalizedName ? [existing.name] : [])];
    const aliases = [...new Map(names.map(alias => [normalizeName(alias), alias.trim()])).entries()]
      .filter(([key]) => key && key !== normalizedName);
    const conflicting = await tx.supplier.findFirst({ where: {
      id: { not: id }, OR: [
        { normalizedName: { in: [normalizedName, ...aliases.map(([key]) => key)] } },
        { aliases: { some: { normalizedAlias: { in: [normalizedName, ...aliases.map(([key]) => key)] } } } },
      ],
    } });
    if (conflicting) throw new ApiError(409, `名称或别名与供应商“${conflicting.name}”重复`);
    const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1));
    const claimed = await tx.supplier.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: {
      name, normalizedName, contactName: input.contactName.trim(), contactPhone: input.contactPhone.trim(), active: input.active, updatedAt,
    } });
    if (claimed.count !== 1) throw new ApiError(409, "供应商已被修改，请刷新后重试");
    await tx.supplierAlias.deleteMany({ where: { supplierId: id } });
    for (const [normalizedAlias, alias] of aliases) await tx.supplierAlias.create({ data: { supplierId: id, normalizedAlias, alias } });
    await tx.auditLog.create({ data: {
      userId: user.id, entityType: "supplier", entityId: id, action: "supplier.updated",
      beforeValue: { name: existing.name, contactName: existing.contactName, contactPhone: existing.contactPhone, active: existing.active, aliases: existing.aliases.map(alias => alias.alias) },
      afterValue: { name, contactName: input.contactName, contactPhone: input.contactPhone, active: input.active, aliases: aliases.map(([, alias]) => alias) },
    } });
    return { saved: true };
  });
}

export async function updateProject(user: SessionUser, id: string, input: { updatedAt: string; name: string; region: string; active: boolean }) {
  if (user.globalRole !== "ADMIN") throw new ApiError(403, "只有管理员可以维护项目点");
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    const existing = await tx.project.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "项目点不存在");
    if (existing.updatedAt.toISOString() !== input.updatedAt) throw new ApiError(409, "项目点已变化，请刷新后重试");
    const duplicate = await tx.project.findFirst({ where: { id: { not: id }, name: { equals: input.name.trim(), mode: "insensitive" } } });
    if (duplicate) throw new ApiError(409, "项目点名称已存在");
    const changed = await tx.project.updateMany({ where: { id, updatedAt: existing.updatedAt }, data: {
      name: input.name.trim(), region: input.region.trim(), active: input.active,
      updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
    } });
    if (changed.count !== 1) throw new ApiError(409, "项目点已变化，请刷新后重试");
    await tx.auditLog.create({ data: {
      userId: user.id, entityType: "project", entityId: id, action: "project.updated",
      beforeValue: { name: existing.name, region: existing.region, active: existing.active },
      afterValue: { name: input.name, region: input.region, active: input.active },
    } });
    return { saved: true };
  });
}

export type ContractUpdate = {
  updatedAt: string; projectId: string; supplierId: string; ingredientId: string;
  unitPrice: number; startsOn: string; endsOn?: string | null;
};
export async function updateContract(user: SessionUser, id: string, input: ContractUpdate) {
  const db = await getReadyDb();
  return db.$transaction(async tx => {
    const existing = await tx.contract.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "合同价不存在");
    for (const projectId of [existing.projectId, input.projectId]) {
      if (!hasPermission(user, "contract.manage", projectId) || !hasPermission(user, "contract.view_price", projectId)) throw new ApiError(403, "没有对应项目合同维护权限");
    }
    if (existing.updatedAt.toISOString() !== input.updatedAt) throw new ApiError(409, "合同价已变化，请刷新后重试");
    const startsOn = parseDateOnly(input.startsOn), endsOn = input.endsOn ? parseDateOnly(input.endsOn) : null;
    if (!startsOn || input.endsOn && !endsOn || endsOn && endsOn < startsOn) throw new ApiError(400, "生效或截止日期无效");
    if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0 || input.unitPrice >= 10_000_000_000) throw new ApiError(400, "合同单价必须大于0且小于100亿");
    const [project, supplier, ingredient] = await Promise.all([
      tx.project.findUnique({ where: { id: input.projectId } }),
      tx.supplier.findUnique({ where: { id: input.supplierId } }),
      tx.ingredient.findUnique({ where: { id: input.ingredientId } }),
    ]);
    if (!project || !supplier || !ingredient) throw new ApiError(400, "项目点、供应商或原材料不存在");
    if (input.projectId !== existing.projectId && !project.active || input.supplierId !== existing.supplierId && !supplier.active || input.ingredientId !== existing.ingredientId && !ingredient.active) throw new ApiError(400, "请选择启用的项目点、供应商和原材料");
    const duplicate = await tx.contract.findFirst({ where: {
      id: { not: id }, projectId: input.projectId, supplierId: input.supplierId,
      ingredientId: input.ingredientId, startsOn,
      unit: input.ingredientId === existing.ingredientId ? existing.unit : ingredient.unit,
      spec: input.ingredientId === existing.ingredientId ? existing.spec : ingredient.spec,
    } });
    if (duplicate) throw new ApiError(409, "相同项目、供应商、材料和生效日期的合同价已存在");
    const data = {
      projectId: input.projectId, supplierId: input.supplierId, ingredientId: input.ingredientId,
      unitPrice: input.unitPrice, startsOn, endsOn,
      spec: input.ingredientId === existing.ingredientId ? existing.spec : ingredient.spec,
      unit: input.ingredientId === existing.ingredientId ? existing.unit : ingredient.unit,
      updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
    };
    const changed = await tx.contract.updateMany({ where: { id, updatedAt: existing.updatedAt }, data });
    if (changed.count !== 1) throw new ApiError(409, "合同价已变化，请刷新后重试");
    await tx.auditLog.create({ data: {
      userId: user.id, entityType: "contract", entityId: id, action: "contract.updated",
      beforeValue: { projectId: existing.projectId, supplierId: existing.supplierId, ingredientId: existing.ingredientId, unitPrice: Number(existing.unitPrice), startsOn: existing.startsOn.toISOString(), endsOn: existing.endsOn?.toISOString() || null, spec: existing.spec, unit: existing.unit },
      afterValue: { ...data, startsOn: startsOn.toISOString(), endsOn: endsOn?.toISOString() || null, updatedAt: data.updatedAt.toISOString() },
    } });
    return { saved: true };
  });
}
