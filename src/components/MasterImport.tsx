"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { importSheets, type MasterImportType } from "@/lib/master-import";

type Result = { dryRun: boolean; errors: { sheet: string; row: number; message: string }[]; summary: { suppliers?: number; ingredients?: number; contracts?: number } | null };
export function MasterImport({ defaultType = "ingredients", onImported }: { defaultType?: MasterImportType; onImported: () => void }) {
  const [open, setOpen] = useState(false), [type, setType] = useState(defaultType);
  const [file, setFile] = useState<File | null>(null), [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function run(dryRun: boolean) {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      const data = new FormData(); data.append("file", file);
      const response = await api.form<Result>(`/api/master-data/import?type=${type}&dryRun=${dryRun ? 1 : 0}`, data);
      setResult(response);
      if (!dryRun && !response.errors.length) onImported();
    } catch (e) { setResult(null); setError(e instanceof Error ? e.message : "导入失败"); }
    finally { setBusy(false); }
  }
  return <>
    <button className="btn btn--outline" onClick={() => setOpen(true)}>批量导入</button>
    <a className="btn btn--outline" href={`/api/master-data/template?type=${defaultType}`}>下载{defaultType === "all" ? "综合" : importSheets[defaultType]}模板</a>
    {open && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-label="批量导入基础资料">
      <div className="modal-head"><h2>批量导入</h2><button className="btn btn--outline" disabled={busy} onClick={() => setOpen(false)}>关闭</button></div>
      <div className="card-body">
        <label className="field">导入类型<select className="select" value={type} disabled={busy} onChange={e => { setType(e.target.value as MasterImportType); setFile(null); setResult(null); setError(""); }}>
          <option value="ingredients">原材料</option><option value="suppliers">供应商</option><option value="contracts">项目合同价</option><option value="all">综合导入（旧三表模板）</option>
        </select></label>
        <p>先下载所选类型模板，从第二行填写，再上传校验。</p>
        {type === "ingredients" && <p>品名、单位必填，例如土豆／斤。规格与单位分列，分类可在原材料页维护。</p>}
        <a className="btn btn--outline" href={`/api/master-data/template?type=${type}`}>下载当前类型模板</a>
        <label className="field">选择Excel文件<input key={type} className="input" type="file" accept=".xlsx" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setError(""); }} /></label>
        {error && <p role="alert">{error}</p>}
        {result?.errors.map((e, i) => <p role="alert" key={i}>{e.sheet}第{e.row}行：{e.message}</p>)}
        {result && !result.errors.length && <p role="status">{result.dryRun ? "校验通过" : "导入成功"} · 供应商{result.summary?.suppliers || 0}条，原材料{result.summary?.ingredients || 0}条，合同价{result.summary?.contracts || 0}条</p>}
        <div className="modal-actions"><button className="btn btn--outline" disabled={!file || busy} onClick={() => run(true)}>校验文件</button><button className="btn btn--primary" disabled={busy || !result?.dryRun || !!result.errors.length} onClick={() => run(false)}>{busy ? "处理中…" : "确认导入"}</button></div>
      </div>
    </section></div>}
  </>;
}
