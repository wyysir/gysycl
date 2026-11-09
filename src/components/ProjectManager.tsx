"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { EditorSheet } from "./EditorSheet";
import { useToast } from "./ToastProvider";
type Project = { id: string; code: string; name: string; region: string; active: boolean; updatedAt: string };
const blank = { code: "", name: "", region: "", active: true };
export function ProjectManager({ onChange }: { onChange: () => Promise<void> }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Project[]>([]), [editing, setEditing] = useState<Project | "new" | null>(null);
  const [form, setForm] = useState(blank), [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [listError, setListError] = useState("");
  async function load() {
    try { setRows((await api.get<{ projects: Project[] }>("/api/projects")).projects); setListError(""); }
    catch (e) { setListError(e instanceof Error ? e.message : "读取失败"); }
  }
  useEffect(() => { void load(); }, []);
  function open(row: Project | "new", toggle = false) {
    setEditing(row); setError(""); setForm(row === "new" ? blank : { ...row, active: toggle ? !row.active : row.active });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || busy) return;
    setBusy(true); setError("");
    try {
      if (editing === "new") await api.post("/api/projects", form);
      else await api.patch(`/api/projects/${editing.id}`, { name: form.name, region: form.region, active: form.active, updatedAt: editing.updatedAt });
      setEditing(null); showToast("项目点已保存"); await load(); await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }
  const visible = rows.filter(row => status === "all" || row.active === (status === "active"));
  return <section className="card"><div className="card-head"><h2>项目点列表</h2><button className="btn btn--primary" onClick={() => open("new")}>新增项目点</button></div>
    <label className="field card-body">状态<select className="select" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部</option><option value="active">启用</option><option value="inactive">停用</option></select></label>
    {listError && <p role="alert">{listError}<button className="btn btn--outline" onClick={load}>重试</button></p>}
    <div className="table-wrap"><table className="data-table"><thead><tr><th>编码</th><th>项目点</th><th>区域</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {visible.map(row => <tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>{row.region || "—"}</td><td>{row.active ? "启用" : "停用"}</td><td><div className="page-actions"><button className="btn btn--outline btn--small" onClick={() => open(row)}>编辑</button><button className="btn btn--outline btn--small" onClick={() => open(row, true)}>{row.active ? "停用" : "启用"}</button></div></td></tr>)}
      {!visible.length && <tr><td colSpan={5}>暂无项目点</td></tr>}
    </tbody></table></div>
    {editing && <EditorSheet title={editing === "new" ? "新增项目点" : "编辑项目点"} onClose={() => { if (!busy) setEditing(null); }}><form onSubmit={save}>
      <label className="field">项目点编码<input className="input" value={form.code} required minLength={2} maxLength={30} pattern="[A-Za-z0-9_-]+" disabled={busy || editing !== "new"} onChange={e => setForm({ ...form, code: e.target.value })} /></label>
      <label className="field">项目点名称<input className="input" value={form.name} required minLength={2} maxLength={80} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field">区域<input className="input" value={form.region} maxLength={50} disabled={busy} onChange={e => setForm({ ...form, region: e.target.value })} /></label>
      {editing !== "new" && <><label><input type="checkbox" disabled={busy} checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />启用项目点</label><p>停用后退出新业务选择列表，历史业务和成员归属保留；重新启用后恢复使用。</p></>}
      {error && <p role="alert">{error}</p>}<div className="modal-actions"><button className="btn btn--outline" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="btn btn--primary" disabled={busy}>保存项目点</button></div>
    </form></EditorSheet>}
  </section>;
}
