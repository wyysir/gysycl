"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from "react";
import { AlertCircle, ArrowLeftRight, CheckCircle2, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMobile } from "@/lib/client/use-mobile";
import { formatMoney } from "./ui";
import { EditorSheet } from "./EditorSheet";
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
  function choose(candidate: { id: string; name: string; unit: string }) {
    if (!editable || !target) return;
    const index = items.findIndex((item) => item.id === target.id);
    onChange(index, {
      ingredientId: candidate.id,
      name: candidate.name,
      unit: candidate.unit,
      spec: candidate.unit,
      matchStatus: "MATCHED",
      matchScore: 1,
    });
    setPickerId(null);
    showToast("已更换材料，数量、单价和行金额已保留，请核对");
  }
  const mobile = useMobile();
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialField, setInitialField] = useState<string | undefined>();
  const previousCount = useRef(items.length);
  const nextAfterSave = useRef<number | null>(null);
  const [savingRow, setSavingRow] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activeIndex = items.findIndex(item => item.id === activeId);
  const activeItem = items[activeIndex];
  const attention = (item: DocumentItem) => !item.ingredientId || item.confidence < threshold ||
    checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.severity !== "INFO");
  const attentionItems = items.filter(attention);
  function openItem(id: string, field?: string) { setInitialField(field); setActiveId(id); }
  function closeItem() {
    setActiveId(null);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-line-id="' + CSS.escape(activeId || "") + '"] button')?.focus({ preventScroll: true }));
  }
  useEffect(() => {
    if (nextAfterSave.current !== null && items[nextAfterSave.current]) {
      setActiveId(items[nextAfterSave.current].id); nextAfterSave.current = null;
      previousCount.current = items.length; return;
    }
    if (items.length > previousCount.current) {
      setActiveId(items.at(-1)!.id); setInitialField("quantity"); setFilter("all");
    }
    previousCount.current = items.length;
    if (activeId && !items.some(item => item.id === activeId)) setActiveId(null);
  }, [items, activeId]);
  useImperativeHandle(editorRef, () => ({ locate(id) { setFilter("all"); openItem(id); } }));
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
  function fields(item: DocumentItem, index: number) {
    return [
      { key: "quantity", label: "数量", value: item.quantity, step: "0.0001" },
      { key: "unit", label: "单位", value: item.unit },
      { key: "unitPrice", label: "单价（元）", value: item.unitPrice, step: "0.0001" },
      { key: "amount", label: "行金额（元）", value: item.amount, step: "0.01" },
    ].map(field => {
      if(field.value === null) return <div className="field" key={field.key}><span>{field.label}</span><span className="sheet-restricted">未授权</span></div>;
      const numeric = field.key !== "unit";
      const priceError = field.key === "unitPrice" && checks.some(check => check.itemId === item.id && check.status === "OPEN" && check.type === "contract_price" && check.severity === "ERROR");
      const input = field.key === "unitPrice" || field.key === "amount" ? <AmountInput className={"input" + (priceError ? " input--error" : "")} aria-invalid={priceError || undefined} aria-label={`第${index + 1}项${field.label.replace("（元）", "")}`}
        min="0" step={field.step} disabled={!editable} value={Number(field.value)} onValueChange={value => {
          if (field.key === "unitPrice") onChange(index, { unitPrice: value, ...(batch || item.amount === null?{}:{amount:Math.round(item.quantity * value * 100) / 100}) });
          else onChange(index, { amount: value });
        }} /> : <input className="input" aria-label={`第${index + 1}项${field.label.replace("（元）", "")}`}
        type={numeric ? "number" : "text"} inputMode={numeric ? "decimal" : undefined}
        min={numeric ? "0" : undefined} step={field.step} disabled={!editable} value={field.value}
        onChange={event => {
          const value = event.target.value;
          if (field.key === "unit") onChange(index, { unit: value, spec: value, ingredientId: null, matchStatus: "UNMATCHED", matchScore: null });
          else if (field.key === "quantity") onChange(index, { quantity: Number(value), ...(batch || item.unitPrice === null || item.amount === null?{}:{amount:Math.round(Number(value) * item.unitPrice * 100) / 100}) });
        }} />;
      return <div className="field" key={field.key} data-edit-field={field.key}><span>{field.label}</span>{input}</div>;
    });
  }
  function roundingNotice(item: DocumentItem, index: number) {
    if(item.unitPrice === null || item.amount === null) return null;
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
    return <div className="line-alerts">
      {checks.filter(check => check.itemId === item.id && check.status === "OPEN" && check.severity !== "INFO" && check.type !== "low_confidence" && check.type !== "line_arithmetic").map(check =>
        <div key={check.id} className={"notice " + (check.severity === "ERROR" ? "notice--red" : "")}><AlertCircle size={18} /><span><strong>{check.title}</strong>：{check.detail}</span></div>)}
      {item.confidence < threshold && <div className="notice"><AlertCircle size={18} /><span>OCR {Math.round(item.confidence * 100)}% 仅提醒，请对照原图。</span></div>}
      {!item.ingredientId && <div className="notice"><AlertCircle size={18} /><span>未匹配，请选择材料或确认新建后提交。</span></div>}
    </div>;
  }
  const shown = filter === "all" ? items : attentionItems;
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
        {mobile ? <div className="line-cards compact-line-list">
          {!batch && <div className="compact-line-columns" aria-hidden="true"><span>单位</span><span>数量</span><span>单价</span><span>金额</span></div>}
          {shown.map(item => {
            const index = items.findIndex(row => row.id === item.id);
            return <article className="line-card ledger-line compact-line" id={"line-" + item.id} data-line-id={item.id} key={item.id} aria-label={`第${index + 1}项明细`}>
              <button className="compact-line-button" aria-haspopup="dialog" onClick={event => openItem(item.id, (event.target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset.field)}>
                <span className="compact-line-title"><small>{String(index + 1).padStart(2, "0")}</small><strong>{item.name || "未命名"}</strong>{compactBadge(item)}<ChevronRight size={15} /></span>
                {batch ? <span className="batch-line-formula"><span>{item.quantity} {item.unit || "待补单位"} × {item.unitPrice === null ? "未授权" : item.unitPrice}</span><b>{formatMoney(item.amount)}</b></span> : <span className="compact-line-values">
                  <span data-field="unit" aria-label={`单位 ${item.unit || "未填写"}`}>{item.unit || "—"}</span>
                  <span data-field="quantity" aria-label={`数量 ${item.quantity}`}>{item.quantity}</span>
                  <span data-field="unitPrice" aria-label="单价">{item.unitPrice === null ? "未授权" : item.unitPrice}</span>
                  <b data-field="amount" aria-label="行金额">{formatMoney(item.amount)}</b>
                </span>}
              </button>
            </article>;
          })}
        </div> : <div className="table-wrap ledger-item-table compact-item-table"><table><thead><tr><th>#</th><th>材料（规格）</th><th>数量</th><th>单位</th><th>单价（元）</th><th>金额（元）</th><th>来源</th></tr></thead><tbody>
          {shown.map(item => {
            const index = items.findIndex(row => row.id === item.id);
            return <tr key={item.id} id={"line-" + item.id} data-line-id={item.id}>
              <td>{index + 1}</td><td><button className="ledger-material" aria-haspopup="dialog" onClick={() => openItem(item.id)}><strong>{item.name || "未命名"}（{item.spec || item.unit || "—"}）</strong>{compactBadge(item)}</button></td>
              {(["quantity", "unit", "unitPrice", "amount"] as const).map(field => <td key={field}><button className="compact-cell" aria-label={`第${index + 1}项${({quantity:"数量",unit:"单位",unitPrice:"单价",amount:"行金额"})[field]}`} onClick={() => openItem(item.id, field)}>{item[field] === null ? "未授权" : field === "amount" ? formatMoney(item.amount) : item[field]}</button></td>)}
              <td>{item.sourcePageNo && onSourcePage ? <button className="link-button source-page" onClick={() => onSourcePage(item.sourcePageNo!)}>第 {item.sourcePageNo} 页</button> : "—"}</td>
            </tr>;
          })}
        </tbody></table></div>}
        {!shown.length && <div className="empty"><p>{items.length ? "没有需要提醒的明细" : "暂无明细，可增加一行手工录入。"}</p></div>}
      </div>
      {activeItem && !pickerId && !externalModalOpen && <EditorSheet key={activeItem.id} className={batch?"batch-line-sheet":undefined} title={`第 ${activeIndex + 1} 行 · ${activeItem.name || "未命名"}`} onClose={()=>{if(!savingRow)closeItem();}} initialField={initialField}>
        {sourcePreview && <div className="batch-edit-source">{sourcePreview}</div>}
        <div className="line-sheet-body">
          {saveError && <p className="text-danger" role="alert">{saveError}</p>}
          <div className="line-sheet-fields">{fields(activeItem, activeIndex)}</div>
          {actions(activeItem, activeIndex)}
          {roundingNotice(activeItem, activeIndex)}
          {alerts(activeItem)}
          <details className="line-sheet-details"><summary>原文、规格与识别信息</summary><p>OCR原文：{activeItem.rawName || "手工新增"}</p><p>规格：{activeItem.spec || activeItem.unit || "未填写"}</p>{badges(activeItem)}</details>
          <div className="line-sheet-navigation">
            {activeItem.sourcePageNo && onSourcePage ? <button className="link-button" onClick={() => onSourcePage(activeItem.sourcePageNo!)}>查看第 {activeItem.sourcePageNo} 页原图</button> : <span className="text-muted">无来源原图</span>}
            <div><button className="link-button" disabled={activeIndex <= 0} onClick={() => openItem(items[activeIndex - 1].id, initialField)}><ChevronLeft size={15} />上一行</button><button className="link-button" disabled={activeIndex >= items.length - 1} onClick={() => openItem(items[activeIndex + 1].id, initialField)}>下一行<ChevronRight size={15} /></button></div>
          </div>
          {onSave && (editable || savingRow) ? <div className="batch-row-save">{[false,true].map(next=><button key={String(next)} className={"btn " + (next?"btn--primary":"btn--outline")} disabled={savingRow || next && activeIndex>=items.length-1} onClick={async()=>{
            setSavingRow(true); if(next)nextAfterSave.current=activeIndex+1;
            try {if(await onSave()){if(!next)closeItem();}else nextAfterSave.current=null;} finally {setSavingRow(false);}
          }}>{savingRow?"保存中…":next?"保存并下一行":"保存本行"}</button>)}</div> : <button className="btn btn--primary line-sheet-done" onClick={closeItem}>完成本行</button>}
          <p className="line-sheet-hint">{editable ? batch?"保留原单金额，修改数量或单价不会自动改金额。":"修改已应用到本单，完成核对后请保存单据" : "当前单据只读"}</p>
        </div>
      </EditorSheet>}
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
