import { normalizeUnit } from "./text";

export function measurementUnit(input: string) {
  const unit = normalizeUnit(input);
  return ({ 升: "l", 毫升: "ml", 克: "g" } as Record<string, string>)[unit] || unit;
}

/** Only universal conversions within a physical dimension; never bottle/box or volume/mass. */
export function standardUnitRatio(from: string, to: string): number | null {
  from = measurementUnit(from); to = measurementUnit(to);
  if (!from || !to) return null;
  if (from === to) return 1;
  for (const scale of [{ kg: 1, g: 0.001, 斤: 0.5, 两: 0.05 }, { l: 1, ml: 0.001 }] as Record<string, number>[]) {
    if (scale[from] && scale[to]) return Number((scale[from] / scale[to]).toPrecision(15));
  }
  return null;
}

export function simpleSpecificationQuantity(spec: string, productBaseUnit: string, materialUnit: string): number | null {
  if (!["瓶", "袋", "桶", "包", "个", "罐", "盒", "只", "杯"].includes(measurementUnit(productBaseUnit))) return null;
  const match = spec.normalize("NFKC").trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|公斤|千克|克|斤|两|升|毫升)$/i);
  if (!match) return null;
  const ratio = standardUnitRatio(match[2], materialUnit);
  return ratio === null ? null : Number((Number(match[1]) * ratio).toPrecision(15));
}

export type MeasurementDto = {
  materialId: string; materialName: string; materialUnit: string;
  productId: string; productVersion: number; productBaseUnit: string;
  productName: string;
  productBaseQuantity: number | null; unitQuantity: number | null;
};

export type MeasurementSnapshot = {
  schemaVersion: 1; materialId: string; materialName: string; materialUnit: string;
  productId: string; productSpec: string; productBaseUnit: string;
  productName: string;
  productBaseQuantity: string | null; unitQuantity: string | null;
  ingredientId: string; inputUnit: string; sourceSpec: string;
  ingredientVersion: number; productVersion: number; capturedAt: string;
};
