// Experimental offline evaluator only. Never imported by the app or worker.
export type ReviewAnchor = {
  lineNo: number; rawName: string; quantity: number; unitPrice: number; amount: number;
};
type Candidate = {
  lineNo: number; rawName: string; sourceLineText: string;
  nameWritingType: string; writingConfidence: number; nameConfidence: number;
  quantity: number | null; unitPrice: number | null; amount: number | null;
};
const norm = (v: string) => v.normalize('NFKC').replace(/\s+/g, '');
const units = /^(?:[+-]?\d+(?:\.\d+)?)?(?:大|小)?(?:公斤|千克|kg|斤|克|g|两|吨|包|袋|箱|件|盒|桶|瓶|罐|个|支|捆|把|板|盘|份|套|张)$/i;
const sameNumbers = (a: Pick<Candidate, 'quantity' | 'amount'>, b: Pick<Candidate, 'quantity' | 'amount'>) =>
  a.quantity !== null && a.amount !== null && a.quantity === b.quantity && a.amount === b.amount;
function candidate(value: unknown): value is Candidate {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['rawName', 'sourceLineText', 'nameWritingType'].every(k => typeof row[k] === 'string') &&
    ['quantity', 'unitPrice', 'amount'].every(k => row[k] === null || typeof row[k] === 'number' && Number.isFinite(row[k])) &&
    ['lineNo', 'writingConfidence', 'nameConfidence']
      .every(k => typeof row[k] === 'number' && Number.isFinite(row[k])) &&
    Number.isInteger(row.lineNo) &&
    (row.writingConfidence as number) >= 0 && (row.writingConfidence as number) <= 1 &&
    (row.nameConfidence as number) >= 0 && (row.nameConfidence as number) <= 1;
}

export function reviewNames(primary: readonly ReviewAnchor[], response: unknown) {
  const keep = (reason: string) => primary.map(row => ({ lineNo: row.lineNo, name: row.rawName, changed: false, reason }));
  if (!response || typeof response !== 'object') return keep('invalid-response');
  const rows = (response as Record<string, unknown>).items;
  if (!Array.isArray(rows) || rows.length !== primary.length ||
    rows.some((row, i) => !row || typeof row !== 'object' || row.lineNo !== i + 1 || primary[i].lineNo !== i + 1)) return keep('row-alignment');
  return primary.map((old, i) => {
    const row: unknown = rows[i];
    if (!candidate(row)) return { lineNo: old.lineNo, name: old.rawName, changed: false, reason: 'invalid-row' };
    const next = norm(row.rawName), before = norm(old.rawName);
    let reason = 'accepted';
    if (row.nameWritingType !== 'handwritten' || row.writingConfidence < .95) reason = 'not-certain-handwriting';
    else if (!sameNumbers(old, row) || row.unitPrice !== null && old.unitPrice !== row.unitPrice) reason = 'numeric-anchor-mismatch';
    else if (primary.some((other, j) => j !== i && sameNumbers(other, old)) ||
      rows.some((other, j) => j !== i && candidate(other) && sameNumbers(other, row))) reason = 'ambiguous-anchor';
    else if (row.nameConfidence < .9 || next.length < 2 || next.length > 80 || /[?？\d=＝×*]/.test(next) || units.test(next)) reason = 'uncertain-name';
    else if (!norm(row.sourceLineText).includes(next)) reason = 'missing-text-evidence';
    else if (next !== before && before.length >= 2 && next.startsWith(before)) reason = 'appended-suffix';
    const changed = reason === 'accepted' && next !== before;
    return { lineNo: old.lineNo, name: changed ? row.rawName.trim() : old.rawName, changed, reason };
  });
}
