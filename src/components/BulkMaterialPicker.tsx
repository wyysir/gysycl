"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export type MaterialChoice = { id: string; name: string; spec: string; unit: string };
export function BulkMaterialPicker({ disabled, onAdd }: { disabled: boolean; onAdd: (materials: MaterialChoice[]) => void }) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState("frequent"), [q, setQ] = useState(""), [page, setPage] = useState(1);
  const [items, setItems] = useState<MaterialChoice[]>([]), [selected, setSelected] = useState<MaterialChoice[]>([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError("");
    api.get<{ items: MaterialChoice[]; total?: number }>(tab === "frequent" ? "/api/master-data/frequent" : `/api/master-data/ingredients?q=${encodeURIComponent(q)}&page=${page}`).then(data => {
      if (active) { setItems(data.items); setTotal(data.total ?? data.items.length); }
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, tab, q, page]);
  return <>
    <button type="button" className="btn btn--outline" disabled={disabled} onClick={() => { setSelected([]); setOpen(true); }}>常用材料多选添加</button>
    {open && <div className="modal-backdrop"><section className="modal-card bulk-material-dialog" role="dialog" aria-modal="true" aria-label="常用材料多选添加">
      <h2>常用材料多选添加</h2>
      <div className="bulk-material-tabs">{[["frequent", "常用材料"], ["library", "材料库"]].map(([value, label]) => <button type="button" className="btn btn--outline" aria-pressed={tab === value} key={value} onClick={() => { setTab(value); setPage(1); }}>{label}</button>)}</div>
      {tab === "library" && <label>搜索材料<input className="input" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} placeholder="品名或别名" /></label>}
      {error && <p role="alert">{error}</p>}
      <div className="bulk-material-list" aria-busy={loading}>
        {loading ? <p>加载中…</p> : items.length ? items.map(material => <label key={material.id} className="bulk-material-option"><input type="checkbox" checked={selected.some(item => item.id === material.id)} onChange={event => setSelected(current => event.target.checked ? [...current, material] : current.filter(item => item.id !== material.id))} /><span>{material.name}<small>{[material.spec, material.unit].filter(Boolean).join(" · ")}</small></span></label>) : <p>暂无材料{tab === "frequent" ? "使用记录，可切换材料库选择" : "匹配，请更换关键词"}。</p>}
      </div>
      {tab === "library" && <div className="bulk-material-tabs"><button type="button" className="btn btn--outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button type="button" className="btn btn--outline" disabled={page * 20 >= total || loading} onClick={() => setPage(page + 1)}>下一页</button></div>}
      <p>添加后填写数量、单价，再保存单据。</p>
      <div className="modal-actions"><button type="button" className="btn btn--outline" onClick={() => setOpen(false)}>取消</button><button type="button" className="btn btn--primary" disabled={!selected.length || disabled} onClick={() => { onAdd(selected); setOpen(false); }}>添加已选 {selected.length} 项</button></div>
    </section></div>}
  </>;
}
