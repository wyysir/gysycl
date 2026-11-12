"use client";
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import type { DocumentItem } from "@/lib/client/types";
import type { ReviewField } from "@/lib/client/item-editing";
import { useMobile } from "@/lib/client/use-mobile";

export function ReviewInlineItems({ items, shown, activeId, selected, select, renderField, renderDetails, renderBadge, renderSave, onChecked, sourcePreview, mobileMode, batch, reviewed }: {
  items: DocumentItem[]; shown: DocumentItem[]; activeId: string | null; selected?: DocumentItem;
  select: (id: string, scroll?: boolean) => void;
  renderField: (item: DocumentItem, index: number, field: ReviewField) => ReactNode;
  renderDetails: (item: DocumentItem, index: number) => ReactNode;
  renderBadge: (item: DocumentItem) => ReactNode;
  renderSave?: ReactNode; onChecked: () => void; sourcePreview?: ReactNode;
  mobileMode?: "compare" | "list"; batch: boolean; reviewed: boolean;
}) {
  const mobile = useMobile();
  const [tab, setTab] = useState("compare");
  const mode = mobileMode || (batch ? tab : "list");
  const index = items.findIndex(item => item.id === selected?.id);
  const fields: ReviewField[] = ["name", "spec", "quantity", "unit", "unitPrice", "amount"];
  return <div className={`review-inline ${batch ? "review-inline--batch" : ""}`} data-mode={mode}>
    {batch && mobile && <nav className="review-mobile-tabs" aria-label="本单核对视图">{[["compare", "对照"], ["image", "原图"], ["list", "全部明细"]].map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setTab(key)}>{label}</button>)}</nav>}
    {sourcePreview && mode !== "list" && <div className="review-embedded-source">{sourcePreview}</div>}
    {(!mobile || mode === "list") && <div className="review-rows" tabIndex={-1} aria-label="全部明细编辑区">
      {mobile ? <div className="review-edit-cards">{shown.map(item => {
        const itemIndex = items.findIndex(row => row.id === item.id);
        return <article className={`review-edit-card ${activeId === item.id ? "is-selected" : ""}`} key={item.id} id={`line-${item.id}`} data-line-id={item.id} aria-label={`第${itemIndex + 1}项明细`} onFocusCapture={() => select(item.id)}>
          <div className="review-edit-card-head"><strong>第{itemIndex + 1}行</strong>{renderBadge(item)}</div>
          <div className="review-input-grid">{fields.map(field => <div key={field}>{renderField(item, itemIndex, field)}</div>)}</div>
          {renderDetails(item, itemIndex)}
        </article>;
      })}</div> : <div className="table-wrap review-grid"><table><colgroup>{[5, 28, 13, 12, 16, 16, 10].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup><thead><tr><th>#</th><th>品名 / 规格</th><th>数量</th><th>单位</th><th>单价</th><th>金额</th><th>定位</th></tr></thead><tbody>
        {shown.map(item => { const itemIndex = items.findIndex(row => row.id === item.id); return <tr key={item.id} id={`line-${item.id}`} data-line-id={item.id} className={activeId === item.id ? "is-selected" : ""} onFocusCapture={() => select(item.id)}>
          <td>{itemIndex + 1}</td><td>{renderField(item, itemIndex, "name")}<small className="review-row-spec">{item.spec || "无规格"}</small>{renderBadge(item)}</td>
          {(["quantity", "unit", "unitPrice", "amount"] as ReviewField[]).map(field => <td key={field}>{renderField(item, itemIndex, field)}</td>)}
          <td><button className="link-button" onClick={() => select(item.id, true)} aria-label={`定位第${itemIndex + 1}行`}>{item.sourcePageNo ? `第${item.sourcePageNo}页` : "本行"}</button></td>
        </tr>; })}
      </tbody></table></div>}
    </div>}
    {selected && (!mobile || mode === "compare") && <section className="review-inspector" aria-label="当前行编辑区">
      <header className="review-row-navigation"><button className="btn btn--outline btn--small" disabled={index <= 0} onClick={() => select(items[index - 1].id, true)}><ChevronLeft size={16} />上一行</button><strong>第 {index + 1} / {items.length} 行</strong><button className="btn btn--outline btn--small" disabled={index < 0 || index >= items.length - 1} onClick={() => select(items[index + 1].id, true)}>下一行<ChevronRight size={16} /></button></header>
      <div className="review-inspector-content" key={selected.id}>
        <div className="review-input-grid">{fields.map(field => <div key={field}>{renderField(selected, index, field)}</div>)}</div>
        {renderDetails(selected, index)}
      </div>
      <div className="review-inspector-actions">{reviewed && <span className="review-observed"><CheckCircle2 size={14} />本行已对照，业务异常仍按校验处理</span>}
        <button className="btn btn--primary" onClick={onChecked}>已核对，下一条问题</button>{renderSave}
      </div>
    </section>}
    {!items.length && <p className="empty">暂无明细，可增加一行手工录入。</p>}
  </div>;
}
