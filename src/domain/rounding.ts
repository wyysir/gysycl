import { roundMoney } from "@/lib/text";

export const MAX_ROUNDING = 0.99;
export type RoundingItem = { quantity: number; unitPrice: number; amount: number; unit: string; name: string; ingredientId?: string | null };
export type RoundingAdjustment = RoundingItem & { adjustmentAmount: number; confirmedBy: string; confirmedAt: string; reason: string };

export function roundingDifference(item: RoundingItem): number {
  return roundMoney(roundMoney(item.quantity * item.unitPrice) - item.amount);
}
export function canConfirmRounding(item: RoundingItem): boolean {
  const difference = roundingDifference(item);
  return [item.quantity, item.unitPrice, item.amount].every(Number.isFinite) &&
    item.quantity > 0 && item.unitPrice > 0 && item.amount >= 0 &&
    Math.abs(item.amount - roundMoney(item.amount)) < 0.000001 && difference >= 0.01 && difference <= MAX_ROUNDING;
}
export function readRoundingAdjustment(value: unknown): RoundingAdjustment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<RoundingAdjustment>;
  return typeof record.confirmedBy === "string" && !!record.confirmedBy &&
    typeof record.confirmedAt === "string" && Number.isFinite(Date.parse(record.confirmedAt)) &&
    record.reason === "供应商抹零" && typeof record.adjustmentAmount === "number"
    ? record as RoundingAdjustment : null;
}
export function validRounding(item: RoundingItem, value: unknown): boolean {
  const record = readRoundingAdjustment(value);
  return !!record && canConfirmRounding(item) &&
    record.quantity === item.quantity && record.unitPrice === item.unitPrice && record.amount === item.amount &&
    record.name === item.name && record.unit === item.unit && (record.ingredientId || null) === (item.ingredientId || null) &&
    Math.abs(record.adjustmentAmount + roundingDifference(item)) < 0.000001;
}
