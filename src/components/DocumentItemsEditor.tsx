"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from "react";
import { AlertCircle, ArrowLeftRight, CheckCircle2, Plus } from "lucide-react";
import { itemEditPatch, reviewIssues, type ReviewField } from "@/lib/client/item-editing";
import { ReviewInlineItems } from "./ReviewInlineItems";
import { AmountInput } from "./AmountInput";
import { canConfirmRounding, roundingDifference } from "@/domain/rounding";

import { api } from "@/lib/client/api";
import type { CheckResult, DocumentItem, IngredientSuggestion } from "@/lib/client/types";
import type { IngredientList } from "@/lib/client/ingredients";
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
  const [pickerId, setPickerId] = useState<string | null>(null),
    [q, setQ] = useState(""),
    [unit, setUnit] = useState(""),
    [page, setPage] = useState(1);
  const [list, setList] = useState<IngredientList | null>(null),
    [suggestions, setSuggestions] = useState<IngredientSuggestion[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const target = items.find((item) => item.id === pickerId);
  useEffect(() => {
    if (!pickerId || !editable) return;
    let current = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q, unit, page: String(page) });
      Promise.all([
        api.get<IngredientList>("/api/master-data/ingredients?" + params),
        q.trim()
          ? api.get<{ suggestions: IngredientSuggestion[] }>(
              "/api/master-data/suggest?type=ingredient&q=" +
                encodeURIComponent(q),
            )
          : Promise.resolve({ suggestions: [] }),
      ])
        .then(([data, recommended]) => {
          if (current) {
            setList(data);
            setSuggestions(
              recommended.suggestions.filter(
                (item) => !unit || item.unit === unit,
              ),
            );
          }
        })
        .catch((e) => {
          if (current) setError(e instanceof Error ? e.message : "搜索失败");
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [pickerId, q, unit, page, editable]);
  function choose(candidate: { id: string; name: string; unit: string; spec?: string }) {
    if (!editable || !target) return;
    const index = items.findIndex((item) => item.id === target.id);
    onChange(index, {
      ingredientId: candidate.id,
      name: candidate.name,
      unit: candidate.unit,
      spec: candidate.spec ?? target.spec,
      matchStatus: "MATCHED",
      matchScore: 1,
    });
    setPickerId(null);
    showToast("已更换材料，数量、单价和行金额已保留，请核对");
  }
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id || null);
  const previousCount = useRef(items.length);
  const nextAfterSave = useRef<number | null>(null);
  const [savingRow, setSavingRow] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(0, items.findIndex(item => item.id === activeId));
  const activeItem = items[activeIndex];
  const attention = (item: DocumentItem) => !item.ingredientId || item.confidence < threshold ||
    checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.severity !== "INFO");
  const attentionItems = items.filter(attention);
  const [observed, setObserved] = useState<Record<string, string>>({});
  const fingerprint = (item: DocumentItem) => JSON.stringify([item.name,item.spec,item.unit,item.quantity,item.unitPrice,item.amount,item.ingredientId]);
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
  function openPicker(item: DocumentItem) {
    setQ(item.name || item.rawName); setUnit(""); setPage(1);
    setList(null); setSuggestions([]); setPickerId(item.id);
  }
  function badges(item: DocumentItem) {
    const low = item.confidence < threshold;
    return <span className="ledger-line-badges">
      <span className={"pill pill--" + (item.ingredientId ? "approved" : "warning")}>{item.ingredientId ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{item.ingredientId ? "已匹配" : "待匹配"}</span>
      <span className={"pill pill--" + (low ? "warning" : "draft")} aria-label={"OCR置信度 " + Math.round(item.confidence * 100) + "%"}>{low && <AlertCircle size={13} />}OCR {Math.round(item.confidence * 100)}%</span>
    </span>;
  }
  function field(item: DocumentItem, index: number, key: ReviewField) {
    const labels = { name: "品名", spec: "规格", quantity: "数量", unit: "单位", unitPrice: "单价", amount: "行金额" };
    const hidden = key === "unitPrice" && visibility?.unitPrice === false || key === "amount" && visibility?.amount === false;
    const value = item[key];
    const priceError = key === "unitPrice" && checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.type === "contract_price" && check.severity === "ERROR");
    const change = (next: string | number) => onChange(index, itemEditPatch(item, key, next, batch));
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
      <button className="link-button" onClick={() => openPicker(item)}><ArrowLeftRight size={14} />更换材料</button>
      {canCreate && <button className="link-button" onClick={() => onNew(index)}>新建品名</button>}
      <button className="link-button line-delete" aria-label={`删除第${index + 1}项`} onClick={() => { if (window.confirm("确认删除这一行明细？保存单据后生效。")) onRemove(index); }}>删除此行</button>
    </div>;
  }
  function alerts(item: DocumentItem) {
    const problems = checks.filter(check => check.itemId === item.id && check.status === "OPEN" && check.severity !== "INFO" && check.type !== "low_confidence" && check.type !== "line_arithmetic");
    const titles = [...problems.map(check => check.title), ...(item.confidence < threshold ? ["低置信，请对照原图"] : []), ...(!item.ingredientId ? ["材料待匹配"] : [])];
    if (!titles.length) return null;
    return <details className={"line-alerts review-line-alerts " + (problems.some(check => check.severity === "ERROR") ? "has-error" : "")}>
      <summary>{[...new Set(titles)].join(" · ")} · 查看原因</summary>
      {problems.map(check =>
        <div key={check.id} className={"notice " + (check.severity === "ERROR" ? "notice--red" : "")}><AlertCircle size={18} /><span><strong>{check.title}</strong>：{check.detail}</span></div>)}
      {item.confidence < threshold && <div className="notice"><AlertCircle size={18} /><span>OCR {Math.round(item.confidence * 100)}% 仅提醒，请对照原图。</span></div>}
      {!item.ingredientId && <div className="notice"><AlertCircle size={18} /><span>未匹配，请选择材料或确认新建后提交。</span></div>}
    </details>;
  }
  const shown = filter === "all" ? items : items.filter(item => attention(item) || item.id === activeId);
  function compactBadge(item: DocumentItem) {
    const error = checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.severity === "ERROR");
    const label = error ? "待处理" : !item.ingredientId ? "待匹配" : item.confidence < threshold ? "核对原单" : attention(item) ? "有提醒" : "";
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
      {pickerId && target && editable ? (
        <div className="modal-backdrop" onMouseDown={() => setPickerId(null)}>
          <section
            className="modal-card material-picker"
            role="dialog"
            aria-modal="true"
            aria-label="更换材料"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>更换材料</h2>
              <button
                className="icon-button"
                aria-label="关闭材料搜索"
                type="button"
                onClick={() => setPickerId(null)}
              >
                ×
              </button>
            </div>
            <p className="text-muted">
              当前：{target.name || "未命名"} · {target.unit || "无单位"}
              。选择后保留数字，请核对计量口径。
            </p>
            <div className="picker-filters">
              <label className="field">
                搜索名称或别名
                <input
                  autoFocus
                  className="input"
                  aria-label="搜索材料名称或别名"
                  value={q}
                  onChange={(event) => {
                    setQ(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="field">
                单位
                <select
                  className="select"
                  aria-label="筛选材料单位"
                  value={unit}
                  onChange={(event) => {
                    setUnit(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部单位</option>
                  {list?.units.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            {error ? (
              <p role="alert" className="line-warning">
                {error}
              </p>
            ) : null}
            {loading ? (
              <p role="status">正在搜索…</p>
            ) : (
              <>
                {suggestions.length ? (
                  <div className="picker-section">
                    <h3>推荐候选</h3>
                    {suggestions.map((item) => (
                      <button
                        type="button"
                        className="picker-result"
                        key={item.id}
                        onClick={() => choose(item)}
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.unit} · {item.category || "未分类"}
                          </small>
                        </span>
                        <span>选择 · {Math.round(item.score * 100)}%</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="picker-section">
                  <h3>材料库搜索结果</h3>
                  {list?.items.map((item) => (
                    <button
                      type="button"
                      className="picker-result"
                      key={item.id}
                      onClick={() => choose(item)}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.unit} · {item.category || "未分类"}
                          {item.aliases.length
                            ? " · " + item.aliases.join("、")
                            : ""}
                        </small>
                      </span>
                      <span>选择此材料</span>
                    </button>
                  ))}
                  {!list?.items.length ? (
                    <p>没有找到合适材料，可修改关键词或新建品名。</p>
                  ) : null}
                </div>
                <div className="pager">
                  <button
                    className="btn btn--outline btn--small"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    第 {page} 页 · {list?.total || 0} 条
                  </span>
                  <button
                    className="btn btn--outline btn--small"
                    disabled={!list || page * 20 >= list.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    下一页
                  </button>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button
                className="btn btn--outline"
                onClick={() => setPickerId(null)}
              >
                取消
              </button>
              <button
                className="btn btn--primary"
                disabled={!canCreate}
                onClick={() => {
                  if (!canCreate) return;
                  const index = items.findIndex((item) => item.id === pickerId);
                  setPickerId(null);
                  onNew(index);
                }}
              >
                新建品名
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
