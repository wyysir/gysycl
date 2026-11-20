import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/permissions";
import { normalizeSpecification, productSpecification, normalizeUnit } from "@/lib/text";
import type { SessionUser } from "./auth";
import type { MeasurementSnapshot } from "@/lib/measurement-units";

export type MeasurementLine = {
  id: string; ingredientId: string | null; name: string; spec: string; unit: string;
  quantity: { toString(): string } | number; amount: { toString(): string } | number;
  measurementSnapshot: unknown;
};
export function readMeasurementSnapshot(item: MeasurementLine): MeasurementSnapshot | null {
  const s = item.measurementSnapshot as MeasurementSnapshot | null;
  if (!s || s.schemaVersion !== 1 || !s.materialId || !s.productId || !s.materialName ||
    s.ingredientId !== item.ingredientId || normalizeUnit(s.inputUnit) !== normalizeUnit(item.unit) || normalizeSpecification(productSpecification(s.sourceSpec, s.inputUnit)) !== normalizeSpecification(productSpecification(item.spec, item.unit))) return null;
  return s;
}
export function measurementFactor(snapshot: MeasurementSnapshot | null): Prisma.Decimal | null {
  if (!snapshot || !snapshot.materialUnit || !snapshot.productBaseUnit || snapshot.productBaseQuantity === null || snapshot.unitQuantity === null) return null;
  try {
    const a = new Prisma.Decimal(snapshot.productBaseQuantity), b = new Prisma.Decimal(snapshot.unitQuantity);
    if (!a.isFinite() || !b.isFinite() || !a.gt(0) || !b.gt(0)) return null;
    return a.mul(b);
  } catch { return null; }
}
type Bucket = { amount: Prisma.Decimal; quantity: Prisma.Decimal; pending: number; noAmount: boolean; noPrice: boolean; lines: number };
const bucket = (): Bucket => ({ amount: new Prisma.Decimal(0), quantity: new Prisma.Decimal(0), pending: 0, noAmount: false, noPrice: false, lines: 0 });
function result(b: Bucket) {
  return { amount: b.noAmount ? null : Number(b.amount.toFixed(2)), quantity: b.pending ? null : Number(b.quantity.toFixed(8)),
    averagePrice: b.pending || b.noAmount || b.noPrice || !b.quantity.gt(0) ? null : Number(b.amount.div(b.quantity).toFixed(4)),
    pending: b.pending, lines: b.lines, amountRestricted: b.noAmount, priceRestricted: b.noPrice };
}

/** Receives already-scoped, approved documents. Never aggregates unauthorized amounts/prices. */
export function aggregateMaterialPurchases(user: SessionUser, documents: { projectId: string; project: { name: string }; items: MeasurementLine[] }[]) {
  const groups = new Map<string, { id: string; name: string; unit: string; configured: boolean; total: Bucket;
    variants: Map<string, { ingredientId: string | null; productId: string | null; name: string; spec: string; unit: string; original: Prisma.Decimal; b: Bucket }>;
    projects: Map<string, { name: string; b: Bucket }>; originals: Map<string, Prisma.Decimal> }>();
  for (const doc of documents) for (const item of doc.items) {
    if (!item.ingredientId) continue;
    const s = readMeasurementSnapshot(item), factor = measurementFactor(s);
    const key = s ? s.materialId : `unassigned|${item.ingredientId}|${item.spec}|${item.unit}`;
    let group = groups.get(key);
    if (!group) { group = { id: s?.materialId || item.ingredientId, name: s?.materialName || item.name, unit: s?.materialUnit || "", configured: !!s, total: bucket(), variants: new Map(), projects: new Map(), originals: new Map() }; groups.set(key, group); }
    if (!group.unit && s?.materialUnit) group.unit = s.materialUnit;
    const vkey = `${s?.productId || item.ingredientId}|${item.spec}|${item.unit}`;
    let variant = group.variants.get(vkey);
    if (!variant) { variant = { ingredientId: item.ingredientId, productId: s?.productId || null, name: s?.productName || item.name, spec: item.spec, unit: item.unit, original: new Prisma.Decimal(0), b: bucket() }; group.variants.set(vkey, variant); }
    let project = group.projects.get(doc.projectId);
    if (!project) { project = { name: doc.project.name, b: bucket() }; group.projects.set(doc.projectId, project); }
    const quantity = new Prisma.Decimal(item.quantity.toString()), amount = new Prisma.Decimal(item.amount.toString());
    const converted = factor && quantity.gt(0) && s?.materialUnit === group.unit ? quantity.mul(factor) : null;
    const canAmount = hasPermission(user, "document.view_amount", doc.projectId), canPrice = hasPermission(user, "document.view_unit_price", doc.projectId);
    for (const b of [group.total, variant.b, project.b]) {
      b.lines++; b.noAmount ||= !canAmount; b.noPrice ||= !canPrice;
      if (canAmount) b.amount = b.amount.add(amount);
      if (converted) b.quantity = b.quantity.add(converted); else b.pending++;
    }
    variant.original = variant.original.add(quantity);
    group.originals.set(item.unit, (group.originals.get(item.unit) || new Prisma.Decimal(0)).add(quantity));
  }
  return Array.from(groups, ([key, g]) => ({ key, materialId: g.id, name: g.name, unit: g.unit, configured: g.configured, ...result(g.total),
    specificationCount: new Set(Array.from(g.variants.values(), v => v.productId || normalizeSpecification(v.spec))).size,
    originalQuantities: Array.from(g.originals, ([unit, value]) => ({ unit, quantity: Number(value.toFixed(8)) })),
    variants: Array.from(g.variants, ([key, v]) => ({ key, ingredientId: v.ingredientId, productId: v.productId, name: v.name, spec: v.spec, purchaseUnit: v.unit, originalQuantity: Number(v.original.toFixed(8)), ...result(v.b) })),
    projects: Array.from(g.projects, ([id, p]) => ({ id, name: p.name, ...result(p.b) })) }));
}

export type MaterialPurchaseAnalysis = ReturnType<typeof aggregateMaterialPurchases>[number];
