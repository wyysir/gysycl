import { pinyin } from "pinyin-pro";
import * as OpenCC from "opencc-js";

const t2s = OpenCC.Converter({ from: "tw", to: "cn" });
const OCR_CONFUSIONS: Record<string, string> = {
  莱: "菜",
  白莱: "白菜",
  青莱: "青菜",
  士豆: "土豆",
  马铃署: "马铃薯",
  鸡旦: "鸡蛋",
  豆付: "豆腐",
  鲈鱼: "鲈鱼",
};

export function normalizeName(input: string): string {
  let value = String(input ?? "").normalize("NFKC").toLowerCase().trim();
  value = t2s(value);
  value = value.replace(/\s+/g, "");
  value = value.replace(/[（）()［］[\]{}<>《》"'“”‘’、，。,:：;；!！?？·._/\\-]/g, "");
  for (const [wrong, right] of Object.entries(OCR_CONFUSIONS)) {
    value = value.replaceAll(wrong, right);
  }
  return value;
}

export function normalizeUnit(input: string): string {
  const value = normalizeName(input);
  const unitMap: Record<string, string> = {
    公斤: "kg",
    千克: "kg",
    斤: "斤",
    袋: "袋",
    箱: "箱",
    桶: "桶",
    包: "包",
    盒: "盒",
  };
  return unitMap[value] || value;
}

function ngrams(value: string, size = 2): Map<string, number> {
  const chars = Array.from(value);
  const result = new Map<string, number>();
  if (chars.length < size) {
    result.set(value, 1);
    return result;
  }
  for (let index = 0; index <= chars.length - size; index += 1) {
    const gram = chars.slice(index, index + size).join("");
    result.set(gram, (result.get(gram) || 0) + 1);
  }
  return result;
}

function diceSimilarity(left: string, right: string): number {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const a = ngrams(left);
  const b = ngrams(right);
  let intersection = 0;
  let total = 0;
  for (const count of a.values()) total += count;
  for (const count of b.values()) total += count;
  for (const [gram, count] of a) {
    intersection += Math.min(count, b.get(gram) || 0);
  }
  return total ? (2 * intersection) / total : 0;
}

function levenshtein(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current =
        a[i - 1] === b[j - 1]
          ? row[j - 1]
          : Math.min(row[j - 1], row[j], previous) + 1;
      row[j - 1] = previous;
      previous = current;
    }
    row[b.length] = previous;
  }
  return row[b.length];
}

function pinyinText(value: string): string {
  return pinyin(value, { toneType: "none", type: "array" })
    .join("")
    .replace(/\s+/g, "");
}

export type NameScore = {
  score: number;
  exact: boolean;
  charScore: number;
  pinyinScore: number;
  editScore: number;
};

export function scoreName(rawQuery: string, rawCandidate: string): NameScore {
  return createNameScorer()(rawQuery, rawCandidate);
}

// Scoped to one matching operation; no stale or unbounded global catalogue cache.
export function createNameScorer() {
  const normalized = new Map<string, string>();
  const phonetics = new Map<string, string>();
  const cached = (cache: Map<string, string>, value: string, convert: (value: string) => string) => {
    let result = cache.get(value);
    if (result === undefined) { result = convert(value); cache.set(value, result); }
    return result;
  };
  return (rawQuery: string, rawCandidate: string): NameScore => {
  const query = cached(normalized, rawQuery, normalizeName);
  const candidate = cached(normalized, rawCandidate, normalizeName);
  if (!query || !candidate) {
    return { score: 0, exact: false, charScore: 0, pinyinScore: 0, editScore: 0 };
  }
  if (query === candidate) {
    return { score: 1, exact: true, charScore: 1, pinyinScore: 1, editScore: 1 };
  }
  if (candidate.includes(query) || query.includes(candidate)) {
    const shorter = Math.min(Array.from(query).length, Array.from(candidate).length);
    const longer = Math.max(Array.from(query).length, Array.from(candidate).length);
    if (shorter / longer >= 0.66) {
      return {
        score: 0.9,
        exact: false,
        charScore: 0.9,
        pinyinScore: 0.9,
        editScore: 0.85,
      };
    }
  }
  const charScore = diceSimilarity(query, candidate);
  const maxLength = Math.max(Array.from(query).length, Array.from(candidate).length);
  const editScore = 1 - levenshtein(query, candidate) / Math.max(1, maxLength);
  const queryPinyin = cached(phonetics, query, pinyinText);
  const candidatePinyin = cached(phonetics, candidate, pinyinText);
  const pinyinScore = diceSimilarity(queryPinyin, candidatePinyin);
  const score = Math.max(
    0,
    Math.min(1, charScore * 0.55 + editScore * 0.25 + pinyinScore * 0.2),
  );
  return { score, exact: false, charScore, pinyinScore, editScore };
  };
}

export function matchLabel(score: number, exact: boolean) {
  if (exact || score >= 0.92) return "MATCHED" as const;
  if (score >= 0.65) return "SIMILAR" as const;
  return "NEW" as const;
}

export function parseMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(
    String(value ?? "")
      .replace(/[,\s￥¥元]/g, "")
      .replace(/[Oo]/g, "0"),
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseDateOnly(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${normalized}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return null;
  // JS 会把 2026-02-30 静默滚动成 2026-03-02，回比规整后的日期以拒绝不存在的年月日。
  return dateOnly(date) === normalized ? date : null;
}

export function dateOnly(value: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
