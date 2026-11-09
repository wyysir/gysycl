"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { EditorSheet } from "./EditorSheet";
import { useToast } from "./ToastProvider";

type Supplier = { id: string; name: string; contactName: string; contactPhone: string; active: boolean; aliases: string[]; updatedAt: string };
const blank = { name: "", contactName: "", contactPhone: "", aliases: "", active: true };
export function SupplierManager({ canManage, canCreate, onChange, revision }: { canManage: boolean; canCreate: boolean; revision: number; onChange: () => Promise<void> }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Supplier[]>([]), [query, setQuery] = useState(""), [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<Supplier | "new" | null>(null), [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [listError, setListError] = useState("");
  async function load() {
    try { setRows((await api.get<{ suppliers: Supplier[] }>(`/api/master-data/suppliers${canManage ? "?status=all" : ""}`)).suppliers); setListError(""); }
    catch (e) { setListError(e instanceof Error ? e.message : "读取失败"); }
  }
  useEffect(() => { void load(); }, [canManage, revision]);
  function open(row: Supplier | "new", toggle = false) {
    setEditing(row); setError("");
    setForm(row === "new" ? blank : { ...row, aliases: row.aliases.join("、"), active: toggle ? !row.active : row.active });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || busy) return;
    setBusy(true); setError("");
    try {
      if (editing === "new") await api.post("/api/master-data/suppliers", { name: form.name, contactName: form.contactName, contactPhone: form.contactPhone, confirmNew: true });
      else await api.patch(`/api/master-data/suppliers/${editing.id}`, { ...form, aliases: form.aliases.split(/[、,，;；\n]/).map(value => value.trim()).filter(Boolean), updatedAt: editing.updatedAt });
      setEditing(null); showToast("供应商已保存"); await load(); await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }
  const visible = rows.filter(row => (!query || [row.name, row.contactName, row.contactPhone, ...row.aliases].some(value => value.includes(query))) && (status === "all" || row.active === (status === "active")));
  return <section className="card">
    <div className="card-head"><h2>供应商列表</h2>{canCreate && <button className="btn btn--primary" onClick={() => open("new")}>新增供应商</button>}</div>
    <div className="toolbar card-body">
      <label className="field">查询供应商<input className="input" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {canManage && <label className="field">状态<select className="select" value={status} onChange={e => setStatus(e.target.value)}><option value="active">启用</option><option value="inactive">停用</option><option value="all">全部</option></select></label>}
    </div>
    {listError && <p role="alert">{listError}<button className="btn btn--outline" onClick={load}>重试</button></p>}
    <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>联系人</th><th>电话</th><th>别名</th><th>状态</th>{canManage && <th>操作</th>}</tr></thead><tbody>
      {visible.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.contactName || "—"}</td><td>{row.contactPhone || "—"}</td><td>{row.aliases.join("、") || "—"}</td><td>{row.active ? "启用" : "停用"}</td>{canManage && <td><div className="page-actions"><button className="btn btn--outline btn--small" onClick={() => open(row)}>编辑</button><button className="btn btn--outline btn--small" onClick={() => open(row, true)}>{row.active ? "停用" : "启用"}</button></div></td>}</tr>)}
      {!visible.length && <tr><td colSpan={canManage ? 6 : 5}>暂无符合条件的供应商</td></tr>}
    </tbody></table></div>
    {editing && <EditorSheet title={editing === "new" ? "新增供应商" : "编辑供应商"} onClose={() => { if (!busy) setEditing(null); }}><form onSubmit={save}>
      <label className="field">供应商名称<input className="input" required maxLength={100} disabled={busy} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field">联系人<input className="input" maxLength={50} disabled={busy} value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></label>
      <label className="field">联系电话<input className="input" maxLength={30} disabled={busy} value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} /></label>
      {editing !== "new" && <><label className="field">别名（用顿号分隔）<input className="input" disabled={busy} value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} /></label><label><input type="checkbox" disabled={busy} checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />启用供应商</label><p>停用后保留历史记录，可在停用列表重新启用。</p></>}
      {error && <p role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="btn btn--outline" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="btn btn--primary" disabled={busy}>保存供应商</button></div>
    </form></EditorSheet>}
  </section>;
}
