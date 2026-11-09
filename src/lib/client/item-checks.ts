import type { CheckResult, DocumentItem } from "./types";

// Server checks describe the last saved snapshot. Only dismiss material checks
// whose condition the current row proves resolved; retain all price/audit checks.
export function currentItemChecks(checks: CheckResult[], items: DocumentItem[]): CheckResult[] {
  const rows = new Map(items.map(item => [item.id, item]));
  return checks.filter(check => {
    if (!check.itemId || check.status !== "OPEN") return true;
    const item = rows.get(check.itemId);
    if (!item) return true;
    if (check.type === "ingredient_unmatched") return !item.ingredientId;
    if (check.type === "ingredient_ambiguous") return !!item.ingredientId && item.matchStatus === "SIMILAR";
    if (check.type === "unit_missing") return !item.unit.trim();
    return true;
  });
}
