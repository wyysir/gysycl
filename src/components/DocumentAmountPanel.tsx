"use client";
import { AmountInput } from "./AmountInput";
import { formatMoney } from "./ui";

export function DocumentAmountPanel({ authorized, editable, subtotal, total, onChange }: {
  authorized: boolean; editable: boolean; subtotal: number | null; total: number | null; onChange: (value: number) => void;
}) {
  return <div className="items-footer">
    <span className="text-muted">未匹配品名需确认后才能提交</span>
    {authorized ? <div className="totals"><div className="total-row"><span>明细合计</span><strong>{formatMoney(subtotal)}</strong></div>
      <div className="total-row total-row--grand"><label htmlFor="document-total">原单总价</label><AmountInput className="cell-input cell-input--num" min="0" step="0.01" id="document-total" aria-label="原单总价" placeholder="待补" value={total} disabled={!editable} onValueChange={onChange} /><small className="text-muted">仅作核对提醒，空值表示待补</small></div>
    </div> : <p className="text-muted">金额未授权</p>}
  </div>;
}
