"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Search, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { usePageMemory, useScrollMemory } from "@/lib/client/page-memory";
import { ErrorState, PageLoading, formatMoney, formatDate } from "@/components/ui";
type Matrix = { ingredientId: string; ingredient: string; spec: string; unit: string; projects: Record<string, number>; samples: Record<string,number>; suppliers: Record<string, { avgPrice: number; minPrice: number; maxPrice: number; samples: number }> };
type Analytics = {
  visibility?:{unitPrice:boolean;amount:boolean};
  range: { from: string; to: string }; projects: Array<{ id: string; name: string; unitPrice?:boolean }>;
  priceMatrix: Matrix[];
  products: Array<{ ingredientId: string; name: string; spec: string; unit: string; spread: number; lines: number }>;
  dimensions: Array<{ name: string; value: number; severity: string }>;
  supplierSpend: Array<{ name: string; amount: number; docs: number }>;
  projectSpend: Array<{ name: string; amount: number; docs: number }>;
};
type History = { total: number; items: Array<{ id: string; documentId: string; docNo: string; docDate: string; supplierName: string; projectName: string; unitPrice: number | null; unit: string }> };
function defaultRange() { const to = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }); return { from: to.slice(0, 7) + "-01", to, projectId: "" }; }
const rowKey = (row: Matrix) => JSON.stringify([row.ingredientId, row.spec, row.unit]);
export default function AnalyticsPage() {
  const [filters, setFilters] = usePageMemory("analytics-filters", defaultRange);
  const [selectedProject, setSelectedProject] = usePageMemory("analytics-selected-project", "");
  const [selectedKey, setSelectedKey] = usePageMemory("analytics-selection", "");
  const [data, setData] = useState<Analytics | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState(filters), [finance, setFinance] = useState(false);
  const [history, setHistory] = useState<History | null>(null), [historyPage, setHistoryPage] = useState(1), [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState(""), [matrixPage, setMatrixPage] = useState(1);
  const querySequence = useRef(0);
  const selected = data?.priceMatrix.find(row => rowKey(row) === selectedKey);
  async function load() {
    const sequence = ++querySequence.current;
    setLoading(true); setError("");
    try {
      const next = await api.get<Analytics>("/api/analytics?" + new URLSearchParams(filters));
      if (sequence !== querySequence.current) return;
      setData(next); setApplied({ ...filters }); setHistoryPage(1); setMatrixPage(1); setSelectedKey(""); setSelectedProject("");
    } catch (e) { if (sequence === querySequence.current) setError(e instanceof Error ? e.message : "加载失败"); }
    finally { if (sequence === querySequence.current) setLoading(false); }
  }
  useEffect(() => { load(); api.get<{ user: { globalRole: string } }>("/api/bootstrap?scope=context").then(b => setFinance(b.user.globalRole === "FINANCE")).catch(() => {}); }, []);
  useScrollMemory("analytics", !loading && !!data);
  useEffect(() => {
    if (!selected) { setHistory(null); return; }
    let current = true; setHistory(null); setHistoryError("");
    const params = new URLSearchParams({ ...applied, unit: selected.unit, spec: selected.spec, page: String(historyPage), projectId: selectedProject || applied.projectId });
    api.get<History>("/api/master-data/ingredients/" + selected.ingredientId + "/history?" + params)
      .then(result => { if (current) setHistory(result); })
      .catch(e => { if (current) setHistoryError(e instanceof Error ? e.message : "采购历史加载失败"); });
    return () => { current = false; };
  }, [selected?.ingredientId, selected?.spec, selected?.unit, applied, historyPage, selectedProject]);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <PageLoading label="正在计算价格矩阵…" />;
  const matches = data.priceMatrix.filter(row => `${row.ingredient} ${row.spec} ${row.unit}`.toLowerCase().includes(search.toLowerCase()));
  const total = data.supplierSpend.reduce((sum, row) => sum + row.amount, 0);
  const maxSpread = Math.max(...data.products.map(row => row.spread), .01);
  const exportQuery = new URLSearchParams({ ...applied, status: "APPROVED" });
  return <div className="page analytics-page">
    <div className="page-head"><div><h1 className="page-title">价格分析 {finance && <span className="pill pill--draft">只读</span>}</h1><p className="page-subtitle">采购统计仅含已通过单据；按规范材料、规格、单位比较</p></div><a className="btn btn--outline" href={"/api/export/documents?" + exportQuery}><Download size={16} />导出Excel</a></div>
    <section className="card analysis-filters"><form className="toolbar" onSubmit={e => { e.preventDefault(); load(); }}>
      <label className="field">开始日期<input className="input" type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} required /></label>
      <label className="field">结束日期<input className="input" type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} required /></label>
      <label className="field">项目范围<select className="select" value={filters.projectId} onChange={e => setFilters({ ...filters, projectId: e.target.value })}><option value="">全部授权项目</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button className="btn btn--primary" disabled={loading}><Search size={16} />{loading ? "查询中…" : "查询"}</button>
    </form></section>
    <section className="analysis-summary card"><div><span>已审核采购额</span><strong>{data.visibility?.amount === false?"未授权":"¥"+formatMoney(total)}</strong></div><div><span>有成交项目</span><strong>{data.projectSpend.length}</strong></div><div><span>可比材料组</span><strong>{data.priceMatrix.length}</strong></div><p className="analysis-scope">采购统计仅含已通过单据；按规范材料、规格、单位比较。</p></section>
    <section className="analysis-columns"><article className="card"><div className="card-head"><div><h2 className="card-title">跨项目价格矩阵</h2><p className="card-subtitle">所选期间平均单价 / 元 · 点击查看采购来源</p></div></div>
      <div className="toolbar"><input className="input" aria-label="搜索矩阵材料" placeholder="搜索材料、规格、单位" value={search} onChange={e => { setSearch(e.target.value);setMatrixPage(1); }} /><span className="text-muted">低价 ░ → ▓ 高价（每行独立比较）</span></div><div className="table-wrap"><table className="price-matrix heatmap"><thead><tr><th>品名 · 规格 · 单位</th>{data.projects.map(p => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody>
        {matches.slice((matrixPage-1)*30,matrixPage*30).map(row => { const prices = Object.values(row.projects); const max = Math.max(...prices), min = Math.min(...prices); return <tr key={rowKey(row)}><th><button className="link-button matrix-label" onClick={() => { setSelectedKey(rowKey(row)); setSelectedProject(""); setHistoryPage(1); }}>{row.ingredient}<small>{row.spec || "无规格"} · {row.unit}</small></button></th>{data.projects.map(p => { const value = row.projects[p.id]; return <td key={p.id} style={value===undefined?undefined:{background:`rgba(118,84,62,${max>min?.12+(value-min)/(max-min)*.72:.22})`,color:max>min&&(value-min)/(max-min)>.55?"white":undefined}}>{p.unitPrice===false?<span className="text-muted">未授权</span>:value === undefined ? <span className="text-muted" title="无成交记录">—</span> : <button title={`${p.name} · ${row.ingredient} · ${row.spec || "无规格"} · ${row.unit} · 平均单价 ${formatMoney(value)}元 · ${row.samples?.[p.id] || 0}条样本`} className={"matrix-value " + (selectedKey === rowKey(row) && selectedProject === p.id ? "is-selected" : "")} onClick={() => { setSelectedKey(rowKey(row)); setSelectedProject(p.id); setHistoryPage(1); }}>{formatMoney(value)}</button>}</td>; })}</tr>; })}
        {!data.priceMatrix.length && <tr><td colSpan={data.projects.length + 1}><div className="empty"><p>{data.visibility?.unitPrice === false ? "没有采购单价查看权限" : "所选区间暂无已通过成交记录"}</p></div></td></tr>}
      </tbody></table></div><div className="pager"><button className="btn btn--outline btn--small" disabled={matrixPage<=1} onClick={()=>setMatrixPage(p=>p-1)}>上一页</button><span>第{matrixPage}页 · {matches.length}组材料</span><button className="btn btn--outline btn--small" disabled={matrixPage*30>=matches.length} onClick={()=>setMatrixPage(p=>p+1)}>下一页</button></div><p className="matrix-legend">颜色仅表示相对高低，不代表异常判定；近30天中位价另用于风险规则。</p>
    </article><article className="card"><div className="card-head"><div><h2 className="card-title">物料价差</h2><p className="card-subtitle">最高成交单价 − 最低成交单价 / 元</p></div></div><div className="table-wrap"><table className="spread-table"><thead><tr><th>品名 · 规格 · 单位</th><th>价差</th><th>价差图示</th></tr></thead><tbody>{data.products.slice(0,10).map(row => <tr key={JSON.stringify([row.ingredientId,row.spec,row.unit])}><td><button onClick={() => { const match = data.priceMatrix.find(m => m.ingredientId === row.ingredientId && m.unit === row.unit && m.spec === row.spec); if (match) { setSelectedKey(rowKey(match)); setSelectedProject(""); setHistoryPage(1); } }}>{row.name} · {row.spec || "无规格"} · {row.unit}</button></td><td className="money">{formatMoney(row.spread)}</td><td><span className="spread-track"><i style={{width: (row.spread / maxSpread * 100) + "%"}} /></span></td></tr>)}{!data.products.length && <tr><td colSpan={3}>暂无可比数据</td></tr>}</tbody></table></div></article></section>
    {selected && <section className="card material-insight" aria-label="材料采购来源"><div className="card-head"><h2 className="card-title">{selected.ingredient} · {data.projects.find(p=>p.id===selectedProject)?.name || "全部授权项目"} · {selected.spec || "无规格"} · {selected.unit}</h2><button className="icon-button" aria-label="关闭材料采购来源" onClick={() => setSelectedKey("")}><X size={18} /></button></div><div className="card-body insight-columns"><div>{selectedProject && <p className="notice">该项目平均单价 ¥{formatMoney(selected.projects[selectedProject])} / {selected.unit} · {selected.samples?.[selectedProject] || 0}条样本；下方采购历史已限定该项目。</p>}<h3>供应商价格对照</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>供应商</th><th>平均单价</th><th>样本数</th></tr></thead><tbody>{Object.entries(selected.suppliers).map(([name, item]) => <tr key={name}><td>{name}</td><td className="money">{formatMoney(item.avgPrice)}</td><td>{item.samples}</td></tr>)}</tbody></table></div></div>
      <div><h3>采购历史</h3>{historyError ? <div className="notice notice--red" role="alert">{historyError}</div> : !history ? <p role="status">正在读取采购历史…</p> : <><div className="table-wrap"><table className="data-table"><thead><tr><th>日期 / 供应商</th><th>项目</th><th>单价</th><th>来源单据</th></tr></thead><tbody>{history.items.map(item => <tr key={item.id}><td>{formatDate(item.docDate)}<small className="ledger-meta">{item.supplierName}</small></td><td>{item.projectName}</td><td className="money">{formatMoney(item.unitPrice)} / {item.unit}</td><td><Link className="link-button" href={"/documents/" + item.documentId + "?from=analytics"}>查看原单</Link></td></tr>)}</tbody></table>{!history.items.length && <p className="empty">暂无采购历史</p>}</div><div className="pager"><button className="btn btn--outline btn--small" disabled={historyPage <= 1} onClick={() => setHistoryPage(p => p - 1)}>上一页</button><span>第{historyPage}页 / 共{history.total}条</span><button className="btn btn--outline btn--small" disabled={historyPage * 20 >= history.total} onClick={() => setHistoryPage(p => p + 1)}>下一页</button></div></>}
      </div></div></section>}
    <details className="card work-secondary"><summary>当前未处理异常 <span className="pill pill--warning">不随采购日期筛选</span></summary><div className="card-body"><p className="text-muted">按项目范围展示当前未关闭项。</p>{data.dimensions.map(row => <div className="ledger-pair" key={row.name}><span>{row.name}</span><strong className={row.severity === "ERROR" ? "text-danger" : "text-warning"}>{row.value}项</strong></div>) }{!data.dimensions.length && <p>当前没有未处理异常</p>}<Link className="link-button" href="/documents">查看单据中心</Link></div></details>
    <details className="card work-secondary"><summary>供应商与项目采购金额</summary><div className="card-body insight-columns"><div><h3>供应商采购额</h3>{data.supplierSpend.map(row => <div className="ledger-pair" key={row.name}><span>{row.name}</span><span className="money">¥{formatMoney(row.amount)}</span></div>)}</div><div><h3>项目采购额</h3>{data.projectSpend.map(row => <div className="ledger-pair" key={row.name}><span>{row.name}</span><span className="money">¥{formatMoney(row.amount)}</span></div>)}</div></div></details>
  </div>;
}
