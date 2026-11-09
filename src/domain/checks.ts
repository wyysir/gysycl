import { validRounding } from "./rounding";
import { normalizeName, roundMoney } from "@/lib/text";

export type Severity = "ERROR" | "WARNING" | "INFO";

export type ItemForCheck = {
  id?: string;
  lineNo: number;
  ingredientId?: string | null;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  roundingAdjustment?: unknown;
  confidence: number;
  matchStatus?: string;
};

export type ContractForCheck = {
  id: string;
  projectId: string;
  supplierId: string;
  ingredientId: string;
  spec: string;
  unit: string;
  unitPrice: number;
  startsOn: Date;
  endsOn: Date | null;
};

export type HistoricalSample = {
  ingredientId: string;
  supplierId: string;
  projectId: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
};

export type CheckDraft = {
  itemId?: string | null;
  dimension: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  expectedValue?: number | null;
  actualValue?: number | null;
};

export type CheckContext = {
  document: {
    projectId: string;
    supplierId?: string | null;
    docDate: Date;
    subtotal: number;
    totalAmount: number;
  };
  items: ItemForCheck[];
  contracts: ContractForCheck[];
  history: HistoricalSample[];
  benchmark: HistoricalSample[];
  thresholds: {
    ocrConfidence: number;
    crossPriceTolerance: number;
    historyPriceTolerance: number;
    quantityOutlierMultiplier: number;
    minBenchmarkSamples: number;
  };
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function average(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function activeContract(
  item: ItemForCheck,
  context: CheckContext,
): ContractForCheck | undefined {
  if (!item.ingredientId) return undefined;
  return context.contracts
    .filter(
      (contract) =>
        contract.projectId === context.document.projectId &&
        contract.supplierId === context.document.supplierId &&
        contract.ingredientId === item.ingredientId &&
        contract.startsOn <= context.document.docDate &&
        (!contract.endsOn || contract.endsOn >= context.document.docDate) &&
        normalizeName(contract.spec) === normalizeName(item.spec) &&
        normalizeName(contract.unit) === normalizeName(item.unit),
    )
    .sort((a, b) => b.startsOn.getTime() - a.startsOn.getTime())[0];
}

export function evaluateDocumentChecks(context: CheckContext): CheckDraft[] {
  const checks: CheckDraft[] = [];
  const add = (check: CheckDraft) => checks.push(check);

  if (!context.items.length) {
    add({
      dimension: "单据完整性",
      type: "empty_items",
      severity: "ERROR",
      title: "单据没有明细",
      detail: "至少需要一行原材料明细才能提交审核。",
    });
  }

  for (const item of context.items) {
    const label = item.name || `第 ${item.lineNo} 行`;
    const calculated = roundMoney(item.quantity * item.unitPrice);
    if (
      item.quantity < 0 ||
      item.unitPrice < 0 ||
      item.amount < 0 ||
      (Math.abs(roundMoney(calculated - item.amount)) >= 0.01 && !validRounding(item, item.roundingAdjustment))
    ) {
      add({
        itemId: item.id,
        dimension: "金额勾稽",
        type: "line_arithmetic",
        severity: "ERROR",
        title: `${label} 行金额不勾稽`,
        detail: `数量 ${item.quantity} × 单价 ${item.unitPrice} 应为 ${calculated.toFixed(2)}，当前为 ${item.amount.toFixed(2)}。`,
        expectedValue: calculated,
        actualValue: item.amount,
      });
    }
    const confidence = Number.isFinite(item.confidence) ? item.confidence : 0;
    if (confidence < context.thresholds.ocrConfidence) {
      add({
        itemId: item.id,
        dimension: "识别质量",
        type: "low_confidence",
        severity: "WARNING",
        title: `${label} 识别置信度偏低`,
        detail: `置信度 ${(confidence * 100).toFixed(1)}%，低于 ${(context.thresholds.ocrConfidence * 100).toFixed(0)}%，请对照原图确认。`,
        expectedValue: context.thresholds.ocrConfidence,
        actualValue: confidence,
      });
    }
    if (!item.ingredientId) {
      add({
        itemId: item.id,
        dimension: "主数据匹配",
        type: "ingredient_unmatched",
        severity: "ERROR",
        title: `${label} 未关联原材料`,
        detail: "请选择相近的已有品名，或确认后新建原材料。",
      });
    } else if (item.matchStatus === "SIMILAR") {
      add({
        itemId: item.id,
        dimension: "主数据匹配",
        type: "ingredient_ambiguous",
        severity: "WARNING",
        title: `${label} 存在相近品名`,
        detail: "当前已关联一个相近品名，请确认没有误合并。",
      });
    }
    if (!item.unit) {
      add({
        itemId: item.id,
        dimension: "主数据匹配",
        type: "unit_missing",
        severity: "ERROR",
        title: `${label} 缺少计量单位`,
        detail: "单位是合同价和跨项目比价的基础，请补全。",
      });
    }

    if (!item.ingredientId) continue;
    const contract = activeContract(item, context);
    if (!contract) {
      add({
        itemId: item.id,
        dimension: "合同价",
        type: "contract_missing",
        severity: "WARNING",
        title: `${label} 未找到本项目合同价`,
        detail: "系统不会套用其他项目点合同价，请确认主数据或采购是否合规。",
      });
    } else if (item.unitPrice > contract.unitPrice + 0.0001) {
      add({
        itemId: item.id,
        dimension: "合同价",
        type: "contract_price",
        severity: "ERROR",
        title: `${label} 高于合同价`,
        detail: `本项目合同价 ${contract.unitPrice.toFixed(2)} 元/${contract.unit}，本次 ${item.unitPrice.toFixed(2)} 元/${item.unit}，上浮 ${(
          (item.unitPrice / contract.unitPrice - 1) *
          100
        ).toFixed(1)}%。`,
        expectedValue: contract.unitPrice,
        actualValue: item.unitPrice,
      });
    }

    const comparable = context.benchmark.filter(
      (sample) =>
        sample.ingredientId === item.ingredientId &&
        normalizeName(sample.spec) === normalizeName(item.spec) &&
        normalizeName(sample.unit) === normalizeName(item.unit) &&
        sample.unitPrice > 0,
    );
    if (comparable.length >= context.thresholds.minBenchmarkSamples) {
      const baseline = median(comparable.map((sample) => sample.unitPrice));
      if (baseline > 0 && item.unitPrice > baseline * (1 + context.thresholds.crossPriceTolerance)) {
        add({
          itemId: item.id,
          dimension: "跨供应商比价",
          type: "cross_supplier_price",
          severity: "WARNING",
          title: `${label} 高于全公司中位价`,
          detail: `近 30 天同品同规格中位价 ${baseline.toFixed(2)} 元，本次 ${item.unitPrice.toFixed(2)} 元，高 ${(
            (item.unitPrice / baseline - 1) *
            100
          ).toFixed(1)}%。`,
          expectedValue: roundMoney(baseline),
          actualValue: item.unitPrice,
        });
      }
    } else {
      add({
        itemId: item.id,
        dimension: "跨供应商比价",
        type: "benchmark_insufficient",
        severity: "INFO",
        title: `${label} 可比样本不足`,
        detail: `近 30 天仅有 ${comparable.length} 条可比价格，暂不判定异常。`,
        actualValue: comparable.length,
      });
    }

    const previous = context.history.filter(
      (sample) =>
        sample.ingredientId === item.ingredientId &&
        sample.supplierId === context.document.supplierId &&
        sample.projectId === context.document.projectId &&
        normalizeName(sample.spec) === normalizeName(item.spec) &&
        normalizeName(sample.unit) === normalizeName(item.unit),
    );
    if (previous.length) {
      const historicalAverage = average(
        previous.map((sample) => sample.unitPrice).filter((price) => price > 0),
      );
      if (
        historicalAverage > 0 &&
        item.unitPrice > historicalAverage * (1 + context.thresholds.historyPriceTolerance)
      ) {
        add({
          itemId: item.id,
          dimension: "历史价格",
          type: "historical_price",
          severity: "WARNING",
          title: `${label} 高于历史均价`,
          detail: `近 30 天同供应商均价 ${historicalAverage.toFixed(2)} 元，本次 ${item.unitPrice.toFixed(2)} 元。`,
          expectedValue: roundMoney(historicalAverage),
          actualValue: item.unitPrice,
        });
      }
      const quantityAverage = average(
        previous.map((sample) => sample.quantity).filter((value) => value > 0),
      );
      if (
        quantityAverage > 0 &&
        item.quantity > quantityAverage * context.thresholds.quantityOutlierMultiplier
      ) {
        add({
          itemId: item.id,
          dimension: "数量异常",
          type: "quantity_outlier",
          severity: "WARNING",
          title: `${label} 数量明显高于历史`,
          detail: `本次 ${item.quantity}，近 30 天平均 ${quantityAverage.toFixed(2)}，超过 ${context.thresholds.quantityOutlierMultiplier} 倍阈值。`,
          expectedValue: roundMoney(quantityAverage),
          actualValue: item.quantity,
        });
      }
    }
  }

  const itemSubtotal = roundMoney(
    context.items.reduce((sum, item) => sum + item.amount, 0),
  );
  if (
    context.items.length > 0 &&
    Math.abs(itemSubtotal - context.document.subtotal) > 0.011
  ) {
    add({
      dimension: "金额勾稽",
      type: "subtotal_mismatch",
      severity: "ERROR",
      title: "明细合计与单据小计不一致",
      detail: `明细合计 ${itemSubtotal.toFixed(2)}，单据小计 ${context.document.subtotal.toFixed(2)}。`,
      expectedValue: itemSubtotal,
      actualValue: context.document.subtotal,
    });
  }
  if (
    context.items.length > 0 &&
    Math.abs(itemSubtotal - context.document.totalAmount) > 0.011
  ) {
    add({
      dimension: "金额勾稽",
      type: "total_mismatch",
      severity: "WARNING",
      title: "原单总价核对提醒",
      detail: `明细合计 ${itemSubtotal.toFixed(2)}，单据总价 ${context.document.totalAmount.toFixed(2)}。`,
      expectedValue: itemSubtotal,
      actualValue: context.document.totalAmount,
    });
  }
  return checks;
}

export function documentTransitionAllowed(
  from: string,
  action: "submit" | "approve" | "return" | "edit",
): boolean {
  const allowed: Record<string, string[]> = {
    submit: ["DRAFT", "NEEDS_REVISION"],
    approve: ["PENDING_REVIEW"],
    return: ["PENDING_REVIEW"],
    edit: ["DRAFT", "NEEDS_REVISION", "PENDING_REVIEW"],
  };
  return allowed[action]?.includes(from) ?? false;
}
