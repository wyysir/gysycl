"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Plus } from "lucide-react";
import { itemEditPatch, reviewIssues, type ReviewField } from "@/lib/client/item-editing";
import { ReviewInlineItems } from "./ReviewInlineItems";
import { AmountInput } from "./AmountInput";
import { canConfirmRounding, roundingDifference } from "@/domain/rounding";

import { MaterialNameField, MaterialUnitField } from "./MaterialLookupFields";
import type { CheckResult, DocumentItem } from "@/lib/client/types";
import { useToast } from "./ToastProvider";

export type DocumentItemsHandle = { locate: (id: string) => void };

export function DocumentItemsEditor({
  items,
  editable,
  canCreate = true,
  threshold,
  onChange,
  onRemove,
  onNew,
  onAdd,
  onSourcePage,
  checks = [],
  editorRef,
  externalModalOpen = false,
  batch = false,
  onSave,
  sourcePreview,
  saveError,
  visibility,
  mobileMode,
  onActiveItem,
}: {
  items: DocumentItem[];
  editable: boolean;
  canCreate?: boolean;
  threshold: number;
  onChange: (index: number, patch: Partial<DocumentItem>) => void;
  onRemove: (index: number) => void;
  onNew: (index: number) => void;
  onAdd: () => void;
  onSourcePage?: (pageNo: number) => void;
  checks?: CheckResult[];
  editorRef?: Ref<DocumentItemsHandle>;
  externalModalOpen?: boolean;
  batch?: boolean;
  onSave?: () => Promise<boolean>;
  sourcePreview?: ReactNode;
  saveError?: string;
  visibility?: { unitPrice: boolean; amount: boolean };
  mobileMode?: "compare" | "list";
  onActiveItem?: (id: string) => void;
}) {
  const { showToast } = useToast();
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id || null);
  const previousCount = useRef(items.length);
  const nextAfterSave = useRef<number | null>(null);
  const [savingRow, setSavingRow] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(0, items.findIndex(item => item.id === activeId));
  const activeItem = items[activeIndex];
  const attention = (item: DocumentItem) => !item.ingredientId || item.confidence < threshold || !!(item.materialChoice && ["master", "unknown"].includes(item.materialChoice.source) && item.materialChoice.confirmedUnit !== item.unit) ||
    checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.severity !== "INFO");
  const attentionItems = items.filter(attention);
  const [observed, setObserved] = useState<Record<string, string>>({});
  const fingerprint = (item: DocumentItem) => JSON.stringify([item.name,item.spec,item.unit,item.quantity,item.unitPrice,item.amount,item.ingredientId,item.materialChoice]);
  function openItem(id: string, scroll = false) {
    setActiveId(id); onActiveItem?.(id);
    const item = items.find(row => row.id === id);
    if (!batch && item?.sourcePageNo) onSourcePage?.(item.sourcePageNo);
    if (scroll) requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>('[data-line-id="' + CSS.escape(id) + '"]') || root.current?.querySelector<HTMLElement>(".review-inspector"))?.scrollIntoView({ block: "nearest" }));
  }
  function checkNext() {
    if (!activeItem) return;
    const nextObserved = { ...observed, [activeItem.id]: fingerprint(activeItem) };
    setObserved(nextObserved);
    const issues = reviewIssues(items, checks, threshold);
    const next = issues.find(issue => nextObserved[issue.id] !== fingerprint(items.find(item => item.id === issue.id)!));
    if (next) openItem(next.id, true);
    else showToast("本轮问题已对照，请保存并重新比对；业务异常仍按校验处理");
  }
  useEffect(() => {
    if (nextAfterSave.current !== null && items[nextAfterSave.current]) {
      openItem(items[nextAfterSave.current].id, true); nextAfterSave.current = null;
      previousCount.current = items.length; return;
    }
    if (items.length > previousCount.current) {
      openItem(items.at(-1)!.id, true); setFilter("all");
    }
    previousCount.current = items.length;
    if (activeId && !items.some(item => item.id === activeId)) setActiveId(items[0]?.id || null);
  }, [items, activeId]);
  useImperativeHandle(editorRef, () => ({ locate(id) { setFilter("all"); openItem(id, true); } }));
  function badges(item: DocumentItem) {
    const low = item.confidence < threshold;
    return <span className="ledger-line-badges">
      <span className={"pill pill--" + (item.ingredientId ? "approved" : "warning")}>{item.ingredientId ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{item.ingredientId ? "已匹配" : item.materialChoice ? "品名已选" : "待匹配"}</span>
      <span className={"pill pill--" + (low ? "warning" : "draft")} aria-label={"OCR置信度 " + Math.round(item.confidence * 100) + "%"}>{low && <AlertCircle size={13} />}OCR {Math.round(item.confidence * 100)}%</span>
    </span>;
  }
  function field(item: DocumentItem, index: number, key: ReviewField) {
    const labels = { name: "品名", spec: "规格", quantity: "数量", unit: "单位", unitPrice: "单价", amount: "行金额" };
    const hidden = key === "unitPrice" && visibility?.unitPrice === false || key === "amount" && visibility?.amount === false;
    const value = item[key];
    const priceError = key === "unitPrice" && checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.type === "contract_price" && check.severity === "ERROR");
    const change = (next: string | number) => onChange(index, itemEditPatch(item, key, next, batch));
    if (key === "name" || key === "unit") return <div className="field" data-edit-field={key} key={key}><span>{labels[key]}</span>{key === "name" ? <MaterialNameField item={item} editable={editable && !externalModalOpen} label={`第${index + 1}项品名`} onChange={patch => onChange(index, patch)} /> : <MaterialUnitField item={{...item, unitPrice: visibility?.unitPrice === false ? null : item.unitPrice, amount: visibility?.amount === false ? null : item.amount}} editable={editable && !externalModalOpen} label={`第${index + 1}项单位`} onChange={patch => onChange(index, patch)} />}</div>;
    return <label className="field" data-edit-field={key} key={key}><span>{labels[key]}</span>{hidden ? <span className="sheet-restricted">未授权</span> :
      key === "quantity" || key === "unitPrice" || key === "amount" ? <AmountInput className={"input" + (priceError ? " input--error" : "")} aria-label={`第${index + 1}项${labels[key]}`} aria-invalid={priceError || undefined} min="0" step={key === "amount" ? "0.01" : "0.0001"} plain={key === "quantity"} value={value as number | null} placeholder="待补" disabled={!editable} onValueChange={change} /> :
      <input className="input" aria-label={`第${index + 1}项${labels[key]}`} value={String(value ?? "")} disabled={!editable} placeholder={key === "spec" ? "无规格" : "待补"} onChange={event => change(event.target.value)} />}</label>;
  }
  function roundingNotice(item: DocumentItem, index: number) {
    if(visibility?.unitPrice === false || visibility?.amount === false || item.unitPrice === null || item.amount === null) return null;
    const monetaryItem={...item,unitPrice:item.unitPrice,amount:item.amount};
    const expected = Math.round(item.quantity * item.unitPrice * 100) / 100;
    const difference = roundingDifference(monetaryItem);
    if (item.roundingConfirmed) return <div className="line-rounding is-confirmed"><span>已确认抹零{difference.toFixed(2)}元{!item.roundingAdjustment && "（保存后生效）"}</span>{editable && <button type="button" className="link-button" aria-label={`撤销第${index + 1}项抹零`} onClick={() => onChange(index, { roundingConfirmed: false, roundingAdjustment: null })}>撤销</button>}</div>;
    if (Math.abs(difference) < 0.01) return null;
    return <div className="line-rounding" role="status"><span>应计{expected.toFixed(2)}，{difference > 0 ? "少" : "多"}{Math.abs(difference).toFixed(2)}元</span>{editable && canConfirmRounding(monetaryItem) && <button type="button" className="link-button" aria-label={`确认第${index + 1}项为抹零`} onClick={() => onChange(index, { roundingConfirmed: true })}>确认为抹零</button>}</div>;
  }
  function actions(item: DocumentItem, index: number) {
    return editable && <div className="line-inline-actions">
      {canCreate && <button className="link-button" onClick={() => onNew(index)}>新建品名</button>}
      <button className="link-button line-delete" aria-label={`删除第${index + 1}项`} onClick={() => { if (window.confirm("确认删除这一行明细？保存单据后生效。")) onRemove(index); }}>删除此行</button>
    </div>;
  }
  function alerts(item: DocumentItem) {
    const problems = checks.filter(check => check.itemId === item.id && check.status === "OPEN" && check.severity !== "INFO" && check.type !== "low_confidence" && check.type !== "line_arithmetic");
    const titles = [...problems.map(check => check.title), ...(item.confidence < threshold ? ["低置信，请对照原图"] : []), ...(!item.ingredientId ? [item.materialChoice ? "采购单位待确认" : "材料待匹配"] : [])];
    if (!titles.length) return null;
    return <details className={"line-alerts review-line-alerts " + (problems.some(check => check.severity === "ERROR") ? "has-error" : "")}>
      <summary>{[...new Set(titles)].join(" · ")} · 查看原因</summary>
      {problems.map(check =>
        <div key={check.id} className={"notice " + (check.severity === "ERROR" ? "notice--red" : "")}><AlertCircle size={18} /><span><strong>{check.title}</strong>：{check.detail}</span></div>)}
      {item.confidence < threshold && <div className="notice"><AlertCircle size={18} /><span>OCR {Math.round(item.confidence * 100)}% 仅提醒，请对照原图。</span></div>}
      {!item.ingredientId && <div className="notice"><AlertCircle size={18} /><span>{item.materialChoice ? "品名已选择，请单独确认采购单位。" : "请在品名框检索并点选材料，或确认新建后提交。"}</span></div>}
    </details>;
  }
  const shown = filter === "all" ? items : items.filter(item => attention(item) || item.id === activeId);
  function compactBadge(item: DocumentItem) {
    const error = checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.severity === "ERROR");
    const label = error ? "待处理" : !item.ingredientId ? item.materialChoice ? "单位待确认" : "待匹配" : item.confidence < threshold ? "核对原单" : attention(item) ? "有提醒" : "";
    return label ? <span className={"compact-line-badge " + (error ? "is-error" : "")}>{label}</span> : null;
  }
  return (
    <>
      <div className="ledger-items compact-items" ref={root}>
        <div className={"ledger-tabs" + (batch ? " batch-line-tools" : "")} role="group" aria-label="明细筛选">
          {batch ? <small className="text-muted">{items.length} 项明细</small> : <><button aria-pressed={filter === "all"} className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>全部 {items.length}</button>
          <button aria-pressed={filter === "attention"} className={filter === "attention" ? "is-active" : ""} onClick={() => setFilter("attention")}>提醒 {attentionItems.length}</button></>}
          {editable && <button className="ledger-add-line" onClick={onAdd}><Plus size={16} />增加一行</button>}
        </div>
        <ReviewInlineItems items={items} shown={shown} activeId={activeItem?.id || activeId} selected={activeItem} select={openItem}
          mobileMode={mobileMode} batch={batch} sourcePreview={sourcePreview} onChecked={checkNext}
          reviewed={!!activeItem && observed[activeItem.id] === fingerprint(activeItem)} renderField={field} renderBadge={compactBadge}
          renderDetails={(item,index) => <>{actions(item,index)}{roundingNotice(item,index)}{alerts(item)}
            <details className="line-sheet-details"><summary>原文、规格与识别信息</summary><p>OCR原文：{item.rawName || "手工新增"}</p>{badges(item)}</details></>}
          renderSave={onSave && (editable || savingRow) ? <div className="batch-row-save">{saveError && <p className="text-danger" role="alert">{saveError}</p>}{[false,true].map(next => <button key={String(next)} className={"btn " + (next ? "btn--primary" : "btn--outline")} disabled={savingRow || next && activeIndex >= items.length - 1} onClick={async () => {
            setSavingRow(true); if (next) nextAfterSave.current = activeIndex + 1;
            try { if (!await onSave()) nextAfterSave.current = null; } finally { setSavingRow(false); }
          }}>{savingRow ? "保存中…" : next ? "保存并下一行" : "保存本行"}</button>)}</div> : undefined}
        />
        {!shown.length && items.length > 0 && <p className="empty">没有需要提醒的明细</p>}
      </div>
    </>
  );
}
