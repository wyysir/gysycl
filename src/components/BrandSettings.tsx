"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, RefreshCw } from "lucide-react";
import { EditorSheet } from "./EditorSheet";
import { api } from "@/lib/client/api";
import type { BrandInfo } from "@/lib/client/brand";
import { BrandLogo, useBrand } from "./BrandProvider";
export function BrandSettings() {
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const { brand, setBrand } = useBrand();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(remove = false) {
    if (!remove && !file) return;

    setBusy(true); setError(""); setMessage("");
    try {
      let result: BrandInfo;
      if (remove) result = await api.delete<BrandInfo>("/api/brand", { version: brand.version });
      else {
        const form = new FormData(); form.set("logo", file!); form.set("version", String(brand.version));
        result = await api.form<BrandInfo>("/api/brand", form);
      }
      setBrand(result); setRemoveOpen(false); setFile(null); if (inputRef.current) inputRef.current.value = ""; setMessage(remove ? "Logo已移除" : "企业Logo已保存，登录页和全部品牌位已更新");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "上传失败，原Logo保持不变"); }
    finally { setBusy(false); }
  }
  return <section className="card brand-settings"><div className="card-body"><BrandLogo /><button className="btn btn--primary" onClick={() => setOpen(true)}>更换企业Logo</button></div>
    {open && <EditorSheet title="更换企业Logo" onClose={() => { if (!busy) { setOpen(false); setFile(null); } }}>

    <div className="card-head"><div><h2 className="card-title">企业品牌</h2><p className="card-subtitle">公司Logo统一展示于登录页、侧栏和手机品牌区</p></div></div>
    <div className="card-body">
      <div className="brand-preview-grid">
        <div className="brand-preview"><span>当前品牌</span><BrandLogo /></div>
        <div className="brand-preview"><span>上传预览</span>{preview ? <img src={preview} alt="待保存的Logo预览" /> : <p className="text-muted">选择图片后在此预览，保存前不影响现有Logo</p>}</div>
      </div>
      <div className="field"><label htmlFor="company-logo">公司Logo</label><input ref={inputRef} id="company-logo" className="input" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
        const next = event.target.files?.[0]; setError(""); setMessage("");
        if (!next) return;
        if (next.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(next.type)) { setFile(null); setError("请选择2MB以内的PNG、JPG或WebP图片"); event.target.value = ""; return; }
        setFile(next);
      }} /></div>
      <p className="page-subtitle">支持PNG、JPG、WebP，最大2MB、1600万像素。保留原图和比例，展示时收紧外侧空白，不裁切标志文字。品牌配色与审核状态颜色保持稳定。</p>
      {error && <div className="notice notice--red" role="alert">{error} <button className="link-button" disabled={busy} onClick={async () => { try { setBrand(await api.get<BrandInfo>("/api/brand")); setError(""); } catch { setError("刷新失败，请稍后重试"); } }}><RefreshCw size={14} /> 刷新当前版本</button></div>}
      {message && <div className="notice" role="status">{message}</div>}
      <div className="brand-actions"><button className="btn btn--primary" disabled={busy || !file} onClick={() => save()}><Upload size={16} />{busy ? "正在保存…" : "保存企业Logo"}</button>
        {file && <button className="btn btn--outline" disabled={busy} onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ""; }}>取消选择</button>}
        {brand.logoUrl && <button className="btn btn--outline" disabled={busy} onClick={() => setRemoveOpen(true)}>移除Logo</button>}
      </div>
    </div></EditorSheet>}
    {removeOpen && <EditorSheet title="移除企业Logo" onClose={() => { if (!busy) setRemoveOpen(false); }}><p>确认移除当前企业Logo？</p>{error && <p role="alert">{error}</p>}<div className="modal-actions"><button className="btn btn--outline" disabled={busy} onClick={() => setRemoveOpen(false)}>取消</button><button className="btn btn--danger" disabled={busy} onClick={() => save(true)}>确认移除</button></div></EditorSheet>}
  </section>;
}
