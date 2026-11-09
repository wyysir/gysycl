"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { hasPermission } from "@/lib/permissions";
import { api } from "@/lib/client/api";
import type { Bootstrap } from "@/lib/client/types";
import { ErrorState, PageLoading, formatDate, dateInputValue } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { EditorSheet } from "@/components/EditorSheet";
import { MasterImport } from "@/components/MasterImport";
import { SupplierManager } from "@/components/SupplierManager";

type Contract = Bootstrap["contracts"][number];
const blank = { projectId: "", supplierId: "", ingredientId: "", unitPrice: "", startsOn: "", endsOn: "" };
export default function MasterPage() {
  const { showToast } = useToast();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState("suppliers");
  const [editing, setEditing] = useState<Contract | "new" | null>(null), [form, setForm] = useState(blank);
  const [removing, setRemoving] = useState<Contract | null>(null), [mergeOpen, setMergeOpen] = useState(false);
  const [mergeType, setMergeType] = useState<"supplier" | "ingredient">("supplier");
  const [source, setSource] = useState(""), [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState("");
  async function load() {
    const data = await api.get<Bootstrap>("/api/bootstrap");
    setBootstrap(data); setRevision(value => value + 1); setError("");
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const ingredient = useMemo(() => bootstrap?.ingredients.find(item => item.id === form.ingredientId), [bootstrap, form.ingredientId]);
  if (!bootstrap) return error ? <ErrorState message={error} onRetry={() => load().catch(e => setError(e.message))} /> : <PageLoading label="正在读取基础资料…" />;
  const user = bootstrap.user;
  const canManage = hasPermission(user, "master.manage"), canCreate = hasPermission(user, "master.create_global");
  const canImport = hasPermission(user, "master.import"), canMerge = hasPermission(user, "master.manage");
  const projects = bootstrap.projects.filter(project => hasPermission(user, "contract.manage", project.id) && hasPermission(user, "contract.view_price", project.id));
  const canEditContract = (contract: Contract) => hasPermission(user, "contract.manage", contract.projectId) && hasPermission(user, "contract.view_price", contract.projectId);
  function openContract(contract: Contract | "new") {
    setSaveError(""); setEditing(contract);
    setForm(contract === "new" ? { ...blank, projectId: projects[0]?.id || "", supplierId: bootstrap!.suppliers[0]?.id || "", ingredientId: bootstrap!.ingredients[0]?.id || "", startsOn: dateInputValue(new Date()) } : {
      projectId: contract.projectId, supplierId: contract.supplierId, ingredientId: contract.ingredientId,
      unitPrice: String(contract.unitPrice), startsOn: dateInputValue(contract.startsOn), endsOn: dateInputValue(contract.endsOn),
    });
  }
  async function saveContract(event: FormEvent) {
    event.preventDefault(); if (!editing || busy) return;
    setBusy(true); setSaveError("");
    try {
      const body = { ...form, unitPrice: Number(form.unitPrice), endsOn: form.endsOn || null };
      if (editing === "new") {
        if (!ingredient) throw new Error("请选择原材料");
        await api.post("/api/contracts", { ...body, spec: ingredient.spec, unit: ingredient.unit });
      } else await api.patch(`/api/contracts/${editing.id}`, { ...body, updatedAt: editing.updatedAt });
      setEditing(null); showToast("合同价已保存"); await load();
    } catch (e) { setSaveError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }
  async function removeContract() {
    if (!removing || busy) return;
    setBusy(true); setSaveError("");
    try { await api.delete(`/api/contracts/${removing.id}`); setRemoving(null); showToast("合同价已删除"); await load(); }
    catch (e) { setSaveError(e instanceof Error ? e.message : "删除失败"); }
    finally { setBusy(false); }
  }
  async function merge(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setSaveError("");
    try { await api.post("/api/master-data/merge", { type: mergeType, sourceId: source, targetId: target }); setMergeOpen(false); showToast("主数据已合并"); await load(); }
    catch (e) { setSaveError(e instanceof Error ? e.message : "合并失败"); }
    finally { setBusy(false); }
  }
  const mergeRows = mergeType === "supplier" ? bootstrap.suppliers : bootstrap.ingredients;
  return <div className="page">
    <div className="page-head"><h1 className="page-title">供应商与合同</h1><div className="page-actions">
      {canImport && <MasterImport defaultType="suppliers" onImported={() => void load().catch(e => setError(e.message))} />}
      {canMerge && <button className="btn btn--outline" onClick={() => { setSource(""); setTarget(""); setSaveError(""); setMergeOpen(true); }}>合并重复资料</button>}
    </div></div>
    {error && <p role="alert">{error}</p>}
    <div className="page-tabs" role="tablist" aria-label="基础资料分类"><button role="tab" aria-selected={tab === "suppliers"} onClick={() => setTab("suppliers")}>供应商</button><button role="tab" aria-selected={tab === "contracts"} onClick={() => setTab("contracts")}>合同价</button></div>
    {tab === "suppliers" ? <SupplierManager canManage={canManage} canCreate={canCreate} revision={revision} onChange={load} /> : <section className="card">
      <div className="card-head"><h2>合同价格清单</h2>{!!projects.length && <button className="btn btn--primary" onClick={() => openContract("new")}>新增合同价</button>}</div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>项目点</th><th>供应商</th><th>原材料</th><th>规格</th><th>单位</th><th>单价</th><th>生效日期</th><th>截止日期</th><th>操作</th></tr></thead><tbody>
        {bootstrap.contracts.map(contract => <tr key={contract.id}><td>{contract.projectName}</td><td>{contract.supplierName}</td><td>{contract.ingredientName}</td><td>{contract.spec || "—"}</td><td>{contract.unit}</td><td>{Number(contract.unitPrice).toLocaleString("zh-CN", {minimumFractionDigits: 2, maximumFractionDigits: 4})}</td><td>{formatDate(contract.startsOn)}</td><td>{formatDate(contract.endsOn)}</td><td>{canEditContract(contract) && <div className="page-actions"><button className="btn btn--outline btn--small" onClick={() => openContract(contract)}>编辑</button><button className="btn btn--outline btn--small" onClick={() => { setSaveError(""); setRemoving(contract); }}>删除</button></div>}</td></tr>)}
        {!bootstrap.contracts.length && <tr><td colSpan={9}>暂无合同价</td></tr>}
      </tbody></table></div>
    </section>}
    {editing && <EditorSheet title={editing === "new" ? "新增合同价" : "编辑合同价"} onClose={() => { if (!busy) setEditing(null); }}><form onSubmit={saveContract}>
      <label className="field">项目点<select className="select" required disabled={busy} value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })}>
        <option value="">请选择</option>{editing !== "new" && !projects.some(item => item.id === editing.projectId) && <option value={editing.projectId}>{editing.projectName}（原归属）</option>}{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="field">供应商<select className="select" required disabled={busy} value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}>
        <option value="">请选择</option>{editing !== "new" && !bootstrap.suppliers.some(item => item.id === editing.supplierId) && <option value={editing.supplierId}>{editing.supplierName}（原归属）</option>}{bootstrap.suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="field">原材料<select className="select" required disabled={busy} value={form.ingredientId} onChange={e => setForm({ ...form, ingredientId: e.target.value })}>
        <option value="">请选择</option>{editing !== "new" && !bootstrap.ingredients.some(item => item.id === editing.ingredientId) && <option value={editing.ingredientId}>{editing.ingredientName}（原归属）</option>}{bootstrap.ingredients.map(item => <option key={item.id} value={item.id}>{item.name} · {item.spec} · {item.unit}</option>)}
      </select></label>
      <p>规格／单位：{editing !== "new" && editing.ingredientId === form.ingredientId ? `${editing.spec}／${editing.unit}` : `${ingredient?.spec || "—"}／${ingredient?.unit || "—"}`}</p>
      <label className="field">合同单价<input className="input" type="number" required step="0.0001" min="0.0001" max="9999999999.9999" disabled={busy} value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })} /></label>
      <label className="field">生效日期<input className="input" type="date" required disabled={busy} value={form.startsOn} onChange={e => setForm({ ...form, startsOn: e.target.value })} /></label>
      <label className="field">截止日期<input className="input" type="date" min={form.startsOn} disabled={busy} value={form.endsOn} onChange={e => setForm({ ...form, endsOn: e.target.value })} /></label>
      {saveError && <p role="alert">{saveError}</p>}<div className="modal-actions"><button type="button" className="btn btn--outline" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="btn btn--primary" disabled={busy}>保存合同价</button></div>
    </form></EditorSheet>}
    {removing && <EditorSheet title="删除合同价" onClose={() => { if (!busy) setRemoving(null); }}><p>{removing.projectName} · {removing.supplierName} · {removing.ingredientName} · {removing.unit}</p><p>确认删除此合同价？历史单据快照继续保留。</p>{saveError && <p role="alert">{saveError}</p>}<div className="modal-actions"><button className="btn btn--outline" disabled={busy} onClick={() => setRemoving(null)}>取消</button><button className="btn btn--danger" disabled={busy} onClick={removeContract}>确认删除合同价</button></div></EditorSheet>}
    {mergeOpen && <EditorSheet title="合并重复资料" onClose={() => { if (!busy) setMergeOpen(false); }}><form onSubmit={merge}>
      <label className="field">类型<select className="select" disabled={busy} value={mergeType} onChange={e => { setMergeType(e.target.value as "supplier" | "ingredient"); setSource(""); setTarget(""); }}><option value="supplier">供应商</option><option value="ingredient">原材料</option></select></label>
      <label className="field">源记录<select className="select" required disabled={busy} value={source} onChange={e => setSource(e.target.value)}><option value="">请选择</option>{mergeRows.map(row => <option key={row.id} value={row.id}>{row.name}{"unit" in row ? ` · ${row.spec} · ${row.unit}` : ""}</option>)}</select></label>
      <label className="field">保留的目标记录<select className="select" required disabled={busy} value={target} onChange={e => setTarget(e.target.value)}><option value="">请选择</option>{mergeRows.filter(row => row.id !== source).map(row => <option key={row.id} value={row.id}>{row.name}{"unit" in row ? ` · ${row.spec} · ${row.unit}` : ""}</option>)}</select></label>
      <p>源记录会停用，别名迁移到目标。已通过单据保留原归属及金额，未审单据与合同价按原有合并规则调整。</p>
      {saveError && <p role="alert">{saveError}</p>}<div className="modal-actions"><button type="button" className="btn btn--outline" disabled={busy} onClick={() => setMergeOpen(false)}>取消</button><button className="btn btn--primary" disabled={busy}>确认合并</button></div>
    </form></EditorSheet>}
  </div>;
}
