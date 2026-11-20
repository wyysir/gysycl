"use client";
import { Fragment, useState } from "react";
import type { MaterialPurchaseAnalysis } from "@/server/measurement-analysis";
import { formatMoney } from "./ui";

const number = (n: number) => n.toLocaleString("zh-CN", { maximumFractionDigits: 8 });
export function MaterialPurchaseAnalysis({ rows, onSource }: { rows: MaterialPurchaseAnalysis[]; onSource: (ingredientId: string, spec: string, unit: string) => void }) {
  const [expanded, setExpanded] = useState<string[]>([]), [search, setSearch] = useState("");
  const filtered = rows.filter(r => r.name.includes(search)), configured = new Set(rows.filter(r => r.configured).map(r => r.materialId)).size;
  return <section className="card"><div className="card-head"><div><h2 className="card-title">按原材料汇总采购</h2><p className="card-subtitle">已归并{configured}种原材料；{rows.filter(r => !r.configured).length}组采购资料待确认归属。不同商品规格、采购单位可展开，只有已确认换算才合计数量。</p></div></div>
    <div className="toolbar"><label className="field">搜索原材料<input className="input" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>原材料</th><th>商品规格</th><th>统一数量</th><th>采购金额</th><th>加权采购均价</th><th>明细</th></tr></thead><tbody>
    {filtered.map(row => <Fragment key={row.key}><tr><td><strong>{row.name}</strong>{!row.configured && <small className="ledger-meta">待确认归属</small>}</td><td>{row.specificationCount}种</td><td>{row.quantity === null ? <span className="text-warning">{row.pending}条待确认换算</span> : `${number(row.quantity)} ${row.unit}`}<small className="ledger-meta">原单：{row.originalQuantities.map(q => `${number(q.quantity)}${q.unit}`).join("＋")}</small></td><td>{row.amount === null ? "未授权" : formatMoney(row.amount)}</td><td>{row.averagePrice === null ? row.priceRestricted || row.amountRestricted ? "未授权" : "暂不计算" : `${row.averagePrice.toFixed(4)}元/${row.unit}`}</td><td><button className="btn btn--outline btn--small" aria-expanded={expanded.includes(row.key)} onClick={() => setExpanded(keys => keys.includes(row.key) ? keys.filter(k => k !== row.key) : [...keys, row.key])}>{expanded.includes(row.key) ? "收起" : "展开规格和单位"}</button></td></tr>
    {expanded.includes(row.key) && <tr><td colSpan={6}><div className="card-body"><h3>商品规格与采购单位</h3><p className="text-muted">换算采用各笔已确认的记录。规格不同的瓶装商品，须依据净含量换到统一单位后比较；总均价表示所选统计单位下的实际采购成本。</p><table className="data-table"><thead><tr><th>商品／规格</th><th>原始数量</th><th>统一数量</th><th>金额</th><th>来源</th></tr></thead><tbody>{row.variants.map(v => <tr key={v.key}><td>{v.name}<small className="ledger-meta">{v.spec || "规格未注明"}</small></td><td>{number(v.originalQuantity)} {v.purchaseUnit}</td><td>{v.quantity === null ? "换算待确认" : `${number(v.quantity)} ${row.unit}`}</td><td>{v.amount === null ? "未授权" : formatMoney(v.amount)}</td><td><button className="link-button" onClick={() => { if (v.ingredientId) onSource(v.ingredientId, v.spec, v.purchaseUnit); }}>查看采购来源</button></td></tr>)}</tbody></table>
      <h3>授权项目对比</h3><table className="data-table"><thead><tr><th>项目</th><th>统一数量</th><th>金额</th><th>加权采购均价</th></tr></thead><tbody>{row.projects.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.quantity === null ? "换算待确认" : `${number(p.quantity)} ${row.unit}`}</td><td>{p.amount === null ? "未授权" : formatMoney(p.amount)}</td><td>{p.averagePrice === null ? p.priceRestricted || p.amountRestricted ? "未授权" : "暂不计算" : `${p.averagePrice.toFixed(4)}元/${row.unit}`}</td></tr>)}</tbody></table></div></td></tr>}</Fragment>)}
    {!filtered.length && <tr><td colSpan={6}>所选范围暂无已通过采购记录</td></tr>}</tbody></table></div>
  </section>;
}
