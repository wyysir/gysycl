import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getReadyDb } from "@/lib/bootstrap";
import { hasPermission } from "@/lib/permissions";
import { normalizeName, normalizeSpecification, productSpecification, normalizeUnit } from "@/lib/text";
import { measurementUnit, standardUnitRatio, simpleSpecificationQuantity, type MeasurementDto, type MeasurementSnapshot } from "@/lib/measurement-units";
import { ApiError, type SessionUser } from "./auth";

const quantity = z.number().positive().max(1e9).refine(value => new Prisma.Decimal(value).decimalPlaces() <= 8, "换算数最多8位小数").nullable().default(null);
export const measurementSchema = z.object({
  version: z.number().int().positive(), materialName: z.string().trim().min(1).max(100),
  materialUnit: z.string().trim().max(30).default(""), productBaseUnit: z.string().trim().max(30).default(""),
  productName: z.string().trim().min(1).max(100).optional(),
  productBaseQuantity: quantity, unitQuantity: quantity,
  productVersion: z.number().int().positive().optional(), applyToHistory: z.boolean().default(false),
});
export type MeasurementInput = z.infer<typeof measurementSchema>;
type ConfiguredIngredient = Prisma.IngredientGetPayload<{ include: { productSpecification: { include: { material: true } } } }>;
export const measurementInclude = { productSpecification: { include: { material: true } } } as const;

export function measurementDto(item: ConfiguredIngredient): MeasurementDto | null {
  const p = item.productSpecification;
  if (!p) return null;
  return { materialId: p.materialId, materialName: p.material.name, materialUnit: p.material.baseUnit,
    productId: p.id, productName: p.name, productVersion: p.version, productBaseUnit: p.baseUnit,
    productBaseQuantity: p.baseQuantity === null ? null : Number(p.baseQuantity),
    unitQuantity: item.quantityPerProductUnit === null ? null : Number(item.quantityPerProductUnit) };
}

/** Missing or mismatched information stays unconverted; no string-based net-content guess. */
export function measurementSnapshot(item: ConfiguredIngredient, spec: string, unit: string): MeasurementSnapshot | null {
  const p = item.productSpecification;
  if (!p || normalizeSpecification(productSpecification(spec, unit)) !== p.normalizedSpec || normalizeSpecification(productSpecification(spec, unit)) !== normalizeSpecification(productSpecification(item.spec, item.unit)) || normalizeUnit(unit) !== item.unit) return null;
  return { schemaVersion: 1, materialId: p.materialId, materialName: p.material.name, materialUnit: p.material.baseUnit,
    productId: p.id, productName: p.name, productSpec: p.spec, productBaseUnit: p.baseUnit,
    productBaseQuantity: p.baseQuantity?.toString() ?? null, unitQuantity: item.quantityPerProductUnit?.toString() ?? null,
    ingredientId: item.id, sourceSpec: spec, inputUnit: normalizeUnit(unit), ingredientVersion: item.version,
    productVersion: p.version, capturedAt: new Date().toISOString() };
}

export async function freezeDocumentMeasurements(tx: Prisma.TransactionClient, documentId: string) {
  const items = await tx.documentItem.findMany({ where: { documentId }, include: { ingredient: { include: measurementInclude } } });
  for (const item of items) {
    if (item.measurementSnapshot || !item.ingredient) continue;
    const snapshot = measurementSnapshot(item.ingredient, item.spec, item.unit);
    if (snapshot) await tx.documentItem.update({ where: { id: item.id }, data: { measurementSnapshot: snapshot as unknown as Prisma.InputJsonValue } });
  }
}

export async function listMeasurements(user: SessionUser) {
  if (!hasPermission(user, "master.manage")) throw new ApiError(403, "没有基础资料维护权限");
  const db = await getReadyDb();
  const materials = await db.materialIdentity.findMany({ orderBy: { name: "asc" }, include: { products: { include: { ingredients: { select: { id: true, name: true, spec: true, unit: true, active: true, version: true, quantityPerProductUnit: true } } } } } });
  return { materials: materials.map(m => ({ id: m.id, name: m.name, baseUnit: m.baseUnit,
    products: m.products.map(p => ({ id: p.id, name: p.name, normalizedName: p.normalizedName, spec: p.spec, normalizedSpec: p.normalizedSpec, baseUnit: p.baseUnit, baseQuantity: p.baseQuantity === null ? null : Number(p.baseQuantity), version: p.version,
      units: p.ingredients.map(i => ({ ...i, quantityPerProductUnit: i.quantityPerProductUnit === null ? null : Number(i.quantityPerProductUnit) })) })) })),
    unassigned: await db.ingredient.count({ where: { productSpecificationId: null } }) };
}

export async function configureMeasurementInTransaction(tx: Prisma.TransactionClient, user: SessionUser, id: string, input: MeasurementInput) {
  if (!hasPermission(user, "master.manage")) throw new ApiError(403, "没有基础资料维护权限");
  if (input.applyToHistory && !hasPermission(user,"measurement.history")) throw new ApiError(403, "只有管理员可以确认历史单据的归属和换算");
  await tx.$queryRaw`SELECT id FROM "Ingredient" WHERE id = ${id} FOR UPDATE`;
  const current = await tx.ingredient.findUnique({ where: { id }, include: measurementInclude });
  if (!current) throw new ApiError(404, "采购资料不存在");
  if (current.version !== input.version) throw new ApiError(409, "采购资料已变化，请刷新后重试");
  const baseUnit = measurementUnit(input.materialUnit), productBaseUnit = measurementUnit(input.productBaseUnit);
  let material = await tx.materialIdentity.findUnique({ where: { normalizedName: normalizeName(input.materialName) } });
  if (!material) material = await tx.materialIdentity.create({ data: { name: input.materialName, normalizedName: normalizeName(input.materialName), baseUnit } });
  await tx.$queryRaw`SELECT id FROM "MaterialIdentity" WHERE id = ${material.id} FOR UPDATE`;
  material = await tx.materialIdentity.findUniqueOrThrow({ where: { id: material.id } });
  if (material.baseUnit && material.baseUnit !== baseUnit) throw new ApiError(409, `该原材料统计单位已是${material.baseUnit}，不能混合统计单位`);
  if (!material.baseUnit && baseUnit) material = await tx.materialIdentity.update({ where: { id: material.id }, data: { baseUnit, version: { increment: 1 } } });
  const productName = input.productName || current.name;
  let product = await tx.productSpecification.findUnique({ where: { materialId_normalizedName_normalizedSpec: { materialId: material.id, normalizedName: normalizeName(productName), normalizedSpec: normalizeSpecification(productSpecification(current.spec, current.unit)) } } });
  const knownProduct = standardUnitRatio(productBaseUnit, baseUnit);
  const knownPurchase = standardUnitRatio(current.unit, productBaseUnit);
  if (knownProduct !== null && input.productBaseQuantity !== null && !new Prisma.Decimal(input.productBaseQuantity).equals(knownProduct)) throw new ApiError(400, "商品基准单位与统计单位的标准换算不一致");
  if (knownPurchase !== null && input.unitQuantity !== null && !new Prisma.Decimal(input.unitQuantity).equals(knownPurchase)) throw new ApiError(400, "采购单位与商品基准单位的标准换算不一致");
  const baseQuantity = knownProduct ?? input.productBaseQuantity, unitQuantity = knownPurchase ?? input.unitQuantity;
  const declaredContent = simpleSpecificationQuantity(current.spec, productBaseUnit, baseUnit);
  if (baseQuantity !== null && declaredContent !== null && !new Prisma.Decimal(baseQuantity).equals(declaredContent)) throw new ApiError(400, `商品规格为${current.spec}，1${productBaseUnit}应折合${declaredContent}${baseUnit}；箱规请在采购单位倍数中填写`);
  const before = measurementDto(current);
  if (product) {
    if (input.productVersion !== undefined && input.productVersion !== product.version) throw new ApiError(409, "共用商品规格配置已变化，请刷新重试");
    if (product.baseUnit && product.baseUnit !== productBaseUnit) throw new ApiError(409, `相同商品规格已使用${product.baseUnit}作基准单位，请保持一致`);
    const sameQuantity = product.baseQuantity === null ? baseQuantity === null : baseQuantity !== null && product.baseQuantity.equals(baseQuantity);
    if (!sameQuantity || product.baseUnit !== productBaseUnit) {
      const initializing = !product.baseUnit && product.baseQuantity === null;
      if (!initializing && (current.productSpecificationId !== product.id || input.productVersion === undefined)) throw new ApiError(409, "共用商品规格换算已配置，请先打开已关联资料核对后修改");
      product = await tx.productSpecification.update({ where: { id: product.id }, data: { baseUnit: productBaseUnit, baseQuantity, version: { increment: 1 } } });
    }
  } else product = await tx.productSpecification.create({ data: { materialId: material.id, name: productName, normalizedName: normalizeName(productName), spec: productSpecification(current.spec, current.unit), normalizedSpec: normalizeSpecification(productSpecification(current.spec, current.unit)), baseUnit: productBaseUnit, baseQuantity } });
  const updated = await tx.ingredient.update({ where: { id }, data: { productSpecificationId: product.id, quantityPerProductUnit: unitQuantity, version: { increment: 1 } }, include: measurementInclude });
  let historicalItemsApplied = 0;
  if (input.applyToHistory) {
    const historical = await tx.documentItem.findMany({ where: { ingredientId: id }, take: 2001 });
    if (historical.length > 2000) throw new ApiError(409, "待确认历史明细超过2000条，请分批处理；本次未保存");
    for (const item of historical) {
      const previous = item.measurementSnapshot as { productBaseQuantity?: unknown; unitQuantity?: unknown } | null;
      if (previous?.productBaseQuantity != null && previous?.unitQuantity != null) continue;
      const snapshot = measurementSnapshot(updated, item.spec, item.unit);
      if (!snapshot) continue;
      await tx.documentItem.update({ where: { id: item.id }, data: { measurementSnapshot: snapshot as unknown as Prisma.InputJsonValue } });
      historicalItemsApplied++;
    }
  }
  await tx.auditLog.create({ data: { userId: user.id, entityType: "ingredient", entityId: id, action: "ingredient.measurementConfigured",
    beforeValue: before as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
    afterValue: { ...measurementDto(updated), historicalItemsApplied, originalPricesAndQuantitiesRetained: true } } });
  return { measurement: measurementDto(updated), version: updated.version, historicalItemsApplied };
}

export async function configureMeasurement(user: SessionUser, id: string, input: MeasurementInput) {
  input = measurementSchema.parse(input);
  return (await getReadyDb()).$transaction(tx => configureMeasurementInTransaction(tx, user, id, input), { timeout: 30000 });
}
