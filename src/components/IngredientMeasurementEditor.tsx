"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import type { IngredientRecord } from "@/lib/client/ingredients";
import { EditorSheet } from "./EditorSheet";
import { useToast } from "./ToastProvider";

type Product = { id: string; name: string; normalizedName: string; spec: string; normalizedSpec: string; baseUnit: string; baseQuantity: number | null; version: number; units: { id: string; name: string; unit: string }[] };
type Material = { id: string; name: string; baseUnit: string; products: Product[] };
export function IngredientMeasurementEditor({ ingredient, isAdmin, onSaved }: { ingredient: IngredientRecord; isAdmin: boolean; onSaved: () => Promise<void> }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]), [selection, setSelection] = useState("new");
  const [form, setForm] = useState({ name: "", productName: "", unit: "", productUnit: "", baseQuantity: "", unitQuantity: "", history: false });
  const selected = materials.find(m => m.id === selection);
  const target = selected?.products.find(p => p.normalizedSpec === ingredient.specificationKey && p.name === form.productName);
  async function show() {
    setError(""); setBusy(true);
    try {
      const result = await api.get<{ materials: Material[] }>("/api/master-data/measurements");
      setMaterials(result.materials); setSelection(ingredient.measurement?.materialId || "new");
      const m = ingredient.measurement;
      setForm({ name: m?.materialName || ingredient.name, productName: m?.productName || ingredient.name, unit: m?.materialUnit || "", productUnit: m?.productBaseUnit || ingredient.unit,
        baseQuantity: m?.productBaseQuantity == null ? "" : String(m.productBaseQuantity), unitQuantity: m?.unitQuantity == null ? "" : String(m.unitQuantity), history: false });
      setOpen(true);
    } catch (e) { showToast(e instanceof Error ? e.message : "读取配置失败", "error"); }
    finally { setBusy(false); }
  }
  function choose(id: string) {
    setSelection(id); setError("");
    const m = materials.find(row => row.id === id), p = m?.products.find(row => row.normalizedSpec === ingredient.specificationKey && row.name === ingredient.name);
    setForm(f => ({ ...f, name: m?.name || ingredient.name, productName: p?.name || ingredient.name, unit: m?.baseUnit || "", productUnit: p?.baseUnit || ingredient.unit,
      baseQuantity: p?.baseQuantity == null ? "" : String(p.baseQuantity), unitQuantity: "", history: false }));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const result = await api.patch<{ historicalItemsApplied: number }>(`/api/master-data/ingredients/${ingredient.id}/measurement`, {
        version: ingredient.version, materialName: form.name, productName: form.productName, materialUnit: form.unit, productBaseUnit: form.productUnit,
        productBaseQuantity: form.baseQuantity.trim() ? Number(form.baseQuantity) : null,
        unitQuantity: form.unitQuantity.trim() ? Number(form.unitQuantity) : null,
        ...(target ? { productVersion: target.version } : {}), applyToHistory: form.history,
      });
      showToast(`归并与换算已保存${result.historicalItemsApplied ? `，已确认${result.historicalItemsApplied}条历史明细` : ""}`);
      setOpen(false); await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }
  return <section className="card mt-16"><div className="card-body">
    <h3>原材料归属与单位换算</h3>
    <p>{ingredient.measurement ? `统计原材料：${ingredient.measurement.materialName} · 统计单位：${ingredient.measurement.materialUnit} · 商品规格：${ingredient.spec || "未注明"}` : "尚未确认统计原材料归属；报表会提示待归并，不按同名自动混合。"}</p>
    <p>商品规格描述大小、净含量等属性；瓶、箱等采购单位只影响数量换算。</p>
    <button type="button" className="btn btn--outline" disabled={busy} onClick={show}>配置原材料归并与换算</button>
  </div>{open && <EditorSheet title="原材料归并与单位换算" onClose={() => { if (!busy) setOpen(false); }}><form onSubmit={save}>
    <p><strong>{ingredient.name}</strong> · 商品规格：{ingredient.spec || "未注明"} · 本采购单位：{ingredient.unit}</p>
    {target && <p>同款采购单位：{[...new Set(target.units.map(u => u.unit))].join("、")}。请分别为各采购单位确认比例。</p>}
    <label className="field">归属于哪一种原材料<select className="select" disabled={busy} value={selection} onChange={e => choose(e.target.value)}><option value="new">新增统计原材料</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}（{m.baseUnit || "统计单位待设置"}）</option>)}</select></label>
    <label className="field">统一原材料名称<input className="input" required maxLength={100} disabled={busy || !!selected} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <label className="field">商品规范名称<input className="input" required maxLength={100} disabled={busy} value={form.productName} onChange={e => setForm({ ...form, productName: e.target.value })} /></label>
    <label className="field">报表统一统计单位<input className="input" maxLength={30} disabled={busy || !!selected?.baseUnit} value={form.unit} placeholder="如kg、斤、l；跨容量比较可用l" onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
    <label className="field">这款商品用什么作基准单位<input className="input" maxLength={30} disabled={busy || !!target?.baseUnit} value={form.productUnit} placeholder="例如瓶；本次采购仍可用箱" onChange={e => setForm({ ...form, productUnit: e.target.value })} /></label>
    <label className="field">1{form.productUnit || "商品基准单位"}折合多少{form.unit || "统计单位"}<input className="input" type="number" step="any" min="0.00000001" max="1000000000" disabled={busy || !!target && target.id !== ingredient.measurement?.productId} value={form.baseQuantity} placeholder="只填已确认值；如500ml瓶装商品折合0.5l，未知留空" onChange={e => setForm({ ...form, baseQuantity: e.target.value })} /></label>
    <label className="field">1{ingredient.unit}包含多少{form.productUnit || "商品基准单位"}<input className="input" type="number" step="any" min="0.00000001" max="1000000000" disabled={busy} value={form.unitQuantity} placeholder="例如1箱12瓶填12；未知留空，相同单位自动按1" onChange={e => setForm({ ...form, unitQuantity: e.target.value })} /></label>
    <p>同款500ml酱油，瓶和箱归入同一商品规格。1l瓶装另设商品规格，再按净含量汇总到同一个原材料；不会把l直接当作kg。</p>
    {target && <p>同一商品规格共用基准单位和净含量换算。箱规只在本采购单位填写，修改后只影响后续新确认记录。</p>}
    {isAdmin && <label className="check-row"><input type="checkbox" checked={form.history} disabled={busy} onChange={e => setForm({ ...form, history: e.target.checked })} />确认用于规格、单位一致且尚无已确认换算的历史明细；原始数量和金额保留，已有已确认换算快照不覆盖</label>}
    <p>不勾选历史确认时，已有报表不会偷偷改变；新审核通过的单据记录当时的归属和换算。未知换算仍可保存归属，报表会提示待确认。</p>
    {error && <p role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="btn btn--outline" disabled={busy} onClick={() => setOpen(false)}>取消</button><button className="btn btn--primary" disabled={busy}>{busy ? "保存中…" : "确认保存归属与换算"}</button></div>
  </form></EditorSheet>}</section>;
}
