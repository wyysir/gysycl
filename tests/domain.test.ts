import { describe, expect, it } from "vitest";
import {
  documentTransitionAllowed,
  evaluateDocumentChecks,
  type CheckContext,
} from "@/domain/checks";
import {
  matchLabel,
  normalizeName,
  normalizeUnit,
  parseDateOnly,
  roundMoney,
  scoreName,
} from "@/lib/text";

describe("name normalization and matching", () => {
  it("normalizes punctuation, width and common OCR confusions", () => {
    expect(normalizeName(" 青 莱 ")).toBe("青菜");
    expect(normalizeName("士豆")).toBe("土豆");
    expect(normalizeName("ＡＢＣ（测试）")).toBe("abc测试");
    expect(normalizeUnit("公斤")).toBe("kg");
  });

  it("scores exact aliases and similar names higher than unrelated names", () => {
    expect(scoreName("青莱", "青菜").score).toBe(1);
    expect(scoreName("猪五花", "猪五花肉").score).toBeGreaterThan(0.85);
    expect(scoreName("青菜", "大米").score).toBeLessThan(0.4);
    expect(matchLabel(1, true)).toBe("MATCHED");
    expect(matchLabel(0.78, false)).toBe("SIMILAR");
    expect(matchLabel(0.2, false)).toBe("NEW");
  });

  it("parses common Chinese date formats without timezone drift", () => {
    const parsed = parseDateOnly("2026年10月19日");
    expect(parsed?.toISOString()).toBe("2026-10-18T16:00:00.000Z");
  });

  it("rejects impossible calendar dates instead of silently normalizing them", () => {
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("2026-02-29")).toBeNull();
    expect(parseDateOnly("2026-04-31")).toBeNull();
    expect(parseDateOnly("2026-13-01")).toBeNull();
    expect(parseDateOnly("2024-02-29")?.toISOString()).toBe(
      "2024-02-28T16:00:00.000Z",
    );
    expect(parseDateOnly("日期 2026年10月19日")?.toISOString()).toBe(
      "2026-10-18T16:00:00.000Z",
    );
  });
});

function baseContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    document: {
      projectId: "prj_sh",
      supplierId: "sup_sh",
      docDate: new Date("2026-10-19T00:00:00+08:00"),
      subtotal: 210,
      totalAmount: 210,
    },
    items: [
      {
        id: "line-1",
        lineNo: 1,
        ingredientId: "ing_qc",
        name: "青菜",
        spec: "散装",
        unit: "kg",
        quantity: 50,
        unitPrice: 4.2,
        amount: 210,
        confidence: 0.96,
        matchStatus: "MATCHED",
      },
    ],
    contracts: [
      {
        id: "contract-1",
        projectId: "prj_sh",
        supplierId: "sup_sh",
        ingredientId: "ing_qc",
        spec: "散装",
        unit: "kg",
        unitPrice: 4.2,
        startsOn: new Date("2026-01-01T00:00:00+08:00"),
        endsOn: new Date("2026-12-31T23:59:59+08:00"),
      },
    ],
    history: [],
    benchmark: [],
    thresholds: {
      ocrConfidence: 0.9,
      crossPriceTolerance: 0.1,
      historyPriceTolerance: 0.1,
      quantityOutlierMultiplier: 2,
      minBenchmarkSamples: 3,
    },
    ...overrides,
  };
}

describe("document checks", () => {
  it("passes a clean, contract-compliant document", () => {
    const checks = evaluateDocumentChecks(baseContext());
    expect(checks.filter((check) => check.severity === "ERROR")).toHaveLength(0);
    expect(checks.some((check) => check.type === "benchmark_insufficient")).toBe(
      true,
    );
  });

  it("detects line arithmetic, total and contract overruns", () => {
    const checks = evaluateDocumentChecks(
      baseContext({
        document: {
          projectId: "prj_sh",
          supplierId: "sup_sh",
          docDate: new Date("2026-10-19T00:00:00+08:00"),
          subtotal: 225,
          totalAmount: 230,
        },
        items: [
          {
            id: "line-1",
            lineNo: 1,
            ingredientId: "ing_qc",
            name: "青菜",
            spec: "散装",
            unit: "kg",
            quantity: 50,
            unitPrice: 4.5,
            amount: 225.5,
            confidence: 0.82,
            matchStatus: "SIMILAR",
          },
        ],
      }),
    );
    expect(checks.some((check) => check.type === "line_arithmetic")).toBe(true);
    expect(checks.some((check) => check.type === "contract_price")).toBe(true);
    expect(checks.some((check) => check.type === "total_mismatch")).toBe(true);
    expect(checks.some((check) => check.type === "low_confidence")).toBe(true);
  });

  it("warns when cross-supplier median is exceeded by more than 10%", () => {
    const checks = evaluateDocumentChecks(
      baseContext({
        items: [
          {
            id: "line-1",
            lineNo: 1,
            ingredientId: "ing_qc",
            name: "青菜",
            spec: "散装",
            unit: "kg",
            quantity: 50,
            unitPrice: 4.2,
            amount: 210,
            confidence: 0.96,
            matchStatus: "MATCHED",
          },
        ],
        benchmark: [
          { ingredientId: "ing_qc", supplierId: "a", projectId: "p1", spec: "散装", unit: "kg", quantity: 10, unitPrice: 3.6 },
          { ingredientId: "ing_qc", supplierId: "b", projectId: "p2", spec: "散装", unit: "kg", quantity: 10, unitPrice: 3.7 },
          { ingredientId: "ing_qc", supplierId: "c", projectId: "p3", spec: "散装", unit: "kg", quantity: 10, unitPrice: 3.8 },
        ],
      }),
    );
    expect(
      checks.some(
        (check) =>
          check.type === "cross_supplier_price" &&
          check.severity === "WARNING",
      ),
    ).toBe(true);
  });

  it("keeps decimals stable for catering quantities", () => {
    expect(roundMoney(12.345 * 3)).toBe(37.04);
  });

  it("flags a zero grand total that contradicts the item amounts", () => {
    const checks = evaluateDocumentChecks(
      baseContext({
        document: {
          projectId: "prj_sh",
          supplierId: "sup_sh",
          docDate: new Date("2026-10-19T00:00:00+08:00"),
          subtotal: 42,
          totalAmount: 0,
        },
        items: [
          {
            id: "line-1",
            lineNo: 1,
            ingredientId: "ing_qc",
            name: "青菜",
            spec: "散装",
            unit: "kg",
            quantity: 10,
            unitPrice: 4.2,
            amount: 42,
            confidence: 1,
            matchStatus: "MATCHED",
          },
        ],
      }),
    );
    const totalMismatch = checks.find((check) => check.type === "total_mismatch");
    expect(totalMismatch?.severity).toBe("WARNING");
  });

  it("treats zero confidence as low confidence instead of skipping the check", () => {
    const checks = evaluateDocumentChecks(
      baseContext({
        items: [
          {
            id: "line-1",
            lineNo: 1,
            ingredientId: "ing_qc",
            name: "青菜",
            spec: "散装",
            unit: "kg",
            quantity: 50,
            unitPrice: 4.2,
            amount: 210,
            confidence: 0,
            matchStatus: "MATCHED",
          },
        ],
      }),
    );
    expect(
      checks.some(
        (check) =>
          check.type === "low_confidence" && check.severity === "WARNING",
      ),
    ).toBe(true);
  });
});

describe("state machine", () => {
  it("only allows valid transitions", () => {
    expect(documentTransitionAllowed("DRAFT", "submit")).toBe(true);
    expect(documentTransitionAllowed("NEEDS_REVISION", "submit")).toBe(true);
    expect(documentTransitionAllowed("PENDING_REVIEW", "approve")).toBe(true);
    expect(documentTransitionAllowed("APPROVED", "edit")).toBe(false);
    expect(documentTransitionAllowed("DRAFT", "approve")).toBe(false);
  });
});
