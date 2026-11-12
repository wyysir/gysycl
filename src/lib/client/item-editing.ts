import type { CheckResult, DocumentItem } from "./types";

export type ReviewField = "name" | "spec" | "quantity" | "unit" | "unitPrice" | "amount";
export function itemEditPatch(item: DocumentItem, field: ReviewField, value: string | number, batch: boolean): Partial<DocumentItem> {
  if (field === "name" || field === "unit" || field === "spec") {
    return { [field]: String(value), ...(field === "spec" || value === item[field] ? {} : { ingredientId: null, matchStatus: "UNMATCHED", matchScore: null }) };
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return {};
  const patch: Partial<DocumentItem> = { [field]: number };
  if (!batch && field !== "amount" && item.amount !== null && item.unitPrice !== null) {
    patch.amount = Math.round((field === "quantity" ? number : item.quantity) * (field === "unitPrice" ? number : item.unitPrice) * 100) / 100;
  }
  return patch;
}

export function reviewIssues(items: DocumentItem[], checks: CheckResult[], threshold: number) {
  return items.flatMap((item, index) => {
    const problems = checks.filter(check => check.itemId === item.id && check.status === "OPEN" && check.severity !== "INFO");
    const error = problems.some(check => check.severity === "ERROR");
    const label = problems.find(check => check.severity === "ERROR")?.title || (!item.ingredientId ? "待匹配" : !item.unit.trim() ? "待补单位" : item.confidence < threshold ? "低置信" : problems[0]?.title);
    return label ? [{ id: item.id, line: index + 1, name: item.name || "未命名", label, error }] : [];
  });
}
