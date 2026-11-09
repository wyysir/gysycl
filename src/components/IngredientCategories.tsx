"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
export type CategoryList = { categories: { name: string; active: boolean; count: number }[]; version: string };
export function IngredientCategories({ data, reload }: { data: CategoryList; reload: () => void }) {
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(false);
  const [name, setName] = useState(""), [previousName, setPreviousName] = useState<string | undefined>();
  const [active, setActive] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try { await api.post("/api/master-data/ingredient-categories", { name, previousName, active, version: data.version }); setEditing(false); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); reload(); }
    finally { setBusy(false); }
  }
  return <><button className="btn btn--outline" onClick={() => setOpen(true)}>分类管理</button>
    {open && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-label="分类管理">
      <div className="modal-head"><h2>分类管理</h2><button className="btn btn--outline" disabled={busy} onClick={() => { setOpen(false); setEditing(false); }}>关闭</button></div>
      <div className="card-body"><button className="btn btn--primary" onClick={() => { setName(""); setPreviousName(undefined); setActive(true); setError(""); setEditing(true); }}>新增分类</button>
        <p>改名后同步调整该分类下材料。停用后保留已有归属，新增和批量调整时不可选择。</p>
        {data.categories.map(item => <div className="catalog-item-head" key={item.name}><span>{item.name} · {item.count}条 · {item.active ? "启用" : "停用"}</span><button className="btn btn--outline btn--small" onClick={() => { setName(item.name); setPreviousName(item.name); setActive(item.active); setError(""); setEditing(true); }}>编辑</button></div>)}
      </div>
    </section></div>}
    {open && editing && <div className="modal-backdrop" style={{ zIndex: 101 }}><section className="modal-card" role="dialog" aria-modal="true" aria-label="编辑分类"><div className="modal-head"><h2>{previousName ? "编辑分类" : "新增分类"}</h2></div><form className="card-body" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="field">分类名称<input className="input" required maxLength={50} value={name} onChange={e => setName(e.target.value)} /></label>
      <label><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />启用分类</label>
      {error && <p role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="btn btn--outline" disabled={busy} onClick={() => setEditing(false)}>取消</button><button className="btn btn--primary" disabled={busy}>保存分类</button></div>
    </form></section></div>}
  </>;
}
