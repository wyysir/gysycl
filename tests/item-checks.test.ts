import { describe, expect, it } from "vitest";
import { currentItemChecks } from "@/lib/client/item-checks";
import type { CheckResult, DocumentItem } from "@/lib/client/types";

const item = { id: "line", ingredientId: null, unit: "", matchStatus: "UNMATCHED" } as DocumentItem;
const check = (type: string, extra: Partial<CheckResult> = {}): CheckResult => ({
  id: type, itemId: item.id, type, dimension: "测试", severity: "ERROR", status: "OPEN",
  title: type, detail: "", expectedValue: null, actualValue: null, ...extra,
});
describe("current material matching feedback", () => {
  const materialChecks = [check("ingredient_unmatched"), check("unit_missing"), check("ingredient_ambiguous", { severity: "WARNING" })];
  it("removes resolved matching errors after creating or selecting a material", () => {
    expect(currentItemChecks(materialChecks, [{ ...item, ingredientId: "new-material", unit: "斤", matchStatus: "MATCHED" }])).toEqual([]);
  });
  it("keeps unmatched and blank-unit errors when still unresolved", () => {
    expect(currentItemChecks(materialChecks, [item]).map(c => c.type)).toEqual(["ingredient_unmatched", "unit_missing"]);
  });
  it("keeps ambiguous match warnings until explicitly matched", () => {
    expect(currentItemChecks(materialChecks, [{ ...item, ingredientId: "similar", unit: "斤", matchStatus: "SIMILAR" }]).map(c => c.type)).toEqual(["ingredient_ambiguous"]);
  });
  it("preserves independent errors, other rows and document-level checks", () => {
    const checks = [check("contract_price"), check("line_arithmetic"), check("low_confidence", { severity: "WARNING" }), check("ingredient_unmatched", { itemId: "another-row" }), check("duplicate_image", { itemId: null })];
    expect(currentItemChecks(checks, [{ ...item, ingredientId: "new", unit: "斤", matchStatus: "MATCHED" }])).toEqual(checks);
  });
  it("does not mutate server checks, so clearing an association restores its error", () => {
    const checks = [check("ingredient_unmatched")];
    expect(currentItemChecks(checks, [{ ...item, ingredientId: "new" }])).toEqual([]);
    expect(currentItemChecks(checks, [item])).toEqual(checks);
    expect(checks).toHaveLength(1);
  });
});
