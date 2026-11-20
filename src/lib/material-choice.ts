export type MaterialUnitOption = { id: string; unit: string; version: number; provisional: boolean };
export type MaterialGroup = { key: string; name: string; spec: string; category: string; options: MaterialUnitOption[]; score: number; matchedAlias?: string };
export type MaterialChoice = {
  v: 1; key: string; name: string; spec: string;
  source: "ocr" | "master" | "manual" | "unknown";
  confirmedUnit: string | null; recordVersion?: number; provisional: boolean;
};
export type ChoiceItem = { name: string; spec: string; unit: string; ingredientId?: string | null; originalUnit?: string; materialChoice?: MaterialChoice | null };

/** Small client-safe unit normalizer; product matching stays on the server. */
export function choiceUnit(value: string) {
  const unit = String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
  return ({ 公斤: "kg", 千克: "kg", 克: "g", 升: "l", 毫升: "ml" } as Record<string, string>)[unit] || unit;
}
export function readMaterialChoice(value: unknown): MaterialChoice | null {
  if (!value || typeof value !== "object") return null;
  const x = value as Partial<MaterialChoice>;
  return x.v === 1 && typeof x.key === "string" && typeof x.name === "string" && typeof x.spec === "string" &&
    ["ocr", "master", "manual", "unknown"].includes(String(x.source)) && (x.confirmedUnit === null || typeof x.confirmedUnit === "string")
    ? { v: 1, key: x.key, name: x.name, spec: x.spec, source: x.source!, confirmedUnit: x.confirmedUnit,
        ...(typeof x.recordVersion === "number" ? { recordVersion: x.recordVersion } : {}), provisional: !!x.provisional } : null;
}
export function chooseMaterial(item: ChoiceItem, group: MaterialGroup, selectedUnit?: string) {
  const previous = item.materialChoice;
  let unit = choiceUnit(selectedUnit === undefined ? item.unit : selectedUnit);
  let source: MaterialChoice["source"] = previous?.source || (choiceUnit(item.originalUnit ?? item.unit) === unit && unit ? "ocr" : "unknown");
  let confirmedUnit = previous?.confirmedUnit ?? null;
  if (selectedUnit === undefined && previous?.key !== group.key && previous?.source === "master" && previous.confirmedUnit !== choiceUnit(item.unit)) {
    unit = ""; source = "unknown"; confirmedUnit = null;
  }
  const units = [...new Set(group.options.map(o => choiceUnit(o.unit)))];
  if (selectedUnit !== undefined) { source = "manual"; confirmedUnit = unit || null; }
  else if (!unit && units.length === 1) { unit = units[0]; source = "master"; confirmedUnit = null; }
  const records = group.options.filter(o => choiceUnit(o.unit) === unit);
  const record = records.length === 1 ? records[0] : records.find(o => o.id === item.ingredientId && previous?.key === group.key);
  const materialChoice: MaterialChoice = { v: 1, key: group.key, name: group.name, spec: group.spec, source,
    confirmedUnit: confirmedUnit === unit ? confirmedUnit : null, provisional: !!record?.provisional,
    ...(record ? { recordVersion: record.version } : {}) };
  return { name: group.name, spec: group.spec, unit, ingredientId: record?.id || null,
    matchStatus: record ? "MATCHED" as const : "UNMATCHED" as const, matchScore: record ? 1 : null, materialChoice };
}
