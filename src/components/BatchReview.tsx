"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiClientError, uploadToTarget } from "@/lib/client/api";
import { batchReady, compressBatchImage, type Batch } from "@/lib/client/batches";
import type { Bootstrap, DocumentDto } from "@/lib/client/types";
import { canRestoreDocument, documentRecovery, type DocumentRecovery } from "@/lib/client/document-recovery";
import { canEditRecord, canSubmitRecord } from "@/lib/permissions";
import { useLeaveProtection, useLocalDraft } from "./LeaveProtection";
import { BatchDocumentCard } from "./BatchDocumentCard";
import { EditorSheet } from "./EditorSheet";
import { ErrorState, PageLoading } from "./ui";
type Recovery = Record<string,DocumentRecovery>;

export function BatchReview({id,bootstrap,embedded=false,uploading=false}:{id:string;bootstrap:Bootstrap;embedded?:boolean;uploading?:boolean}) {
  const [batch,setBatch]=useState<Batch|null>(null),[error,setError]=useState("");
  const [drafts,setDrafts]=useState<Record<string,DocumentDto>>({}),[busyIds,setBusyIds]=useState<Record<string,boolean>>({});
  const [filter,setFilter]=useState("all"),[submitting,setSubmitting]=useState(false),[recoveryConflict,setRecoveryConflict]=useState(false);
  const [results,setResults]=useState<Array<{id:string;ok:boolean;message:string}>|null>(null);
  const recovery=useLocalDraft<Recovery>(`/batches/${id}`),restored=useRef(false);
  const endpoint=`/api/batches/${id}`;
  const load=useCallback(async()=>{try{const data=await api.get<Batch>(endpoint);setBatch(old=>({...data,documents:data.documents.map(incoming=>{
    const previous=old?.documents.find(d=>d.id===incoming.id);
    return previous && previous.version>incoming.version && JSON.stringify(previous.visibility)===JSON.stringify(incoming.visibility)?previous:incoming;
  })}));setError("");}catch(e){setError(e instanceof Error?e.message:"批次加载失败");}},[endpoint]);
  useEffect(()=>{void load();let disposed=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{if(!document.hidden)await load();if(!disposed)timer=setTimeout(poll,2500);};timer=setTimeout(poll,2500);
    return()=>{disposed=true;clearTimeout(timer);};},[load]);
  useEffect(()=>{
    if(!batch||!recovery.ready||restored.current)return;restored.current=true;
    const recovered:Record<string,DocumentDto>={};let conflict=false;
    for(const [key,saved] of Object.entries(recovery.draft?.value||{})){
      const current=batch.documents.find(d=>d.id===key);
      if(current&&canRestoreDocument(saved,current,canEditRecord(bootstrap.user,current))) recovered[key]={...current,...saved.fields};
      else conflict=true;
    }
    setDrafts(current=>({...recovered,...current}));setRecoveryConflict(conflict);
  },[batch,recovery.ready,recovery.draft,bootstrap.user]);
  const recoveryValue=useCallback(()=>Object.fromEntries(Object.entries(drafts).map(([key,doc])=>[key,documentRecovery(doc,true,"")])),[drafts]);
  useEffect(()=>{if(!restored.current||recoveryConflict)return;const timer=setTimeout(()=>{if(Object.keys(drafts).length)void recovery.write(recoveryValue());else void recovery.clear();},400);return()=>clearTimeout(timer);},[drafts,recovery.write,recovery.clear,recoveryValue,recoveryConflict]);
  const busy=submitting||uploading||Object.values(busyIds).some(Boolean);
  useLeaveProtection({dirty:!embedded&&Object.keys(drafts).length>0,busy:!embedded&&busy,
    keep:async()=>recoveryConflict?false:recovery.write(recoveryValue()),
    discard:async()=>{setDrafts({});return recovery.clear();}});
  function saved(doc:DocumentDto){setDrafts(old=>{const next={...old};delete next[doc.id];return next;});setBatch(old=>old?{...old,documents:old.documents.map(d=>d.id===doc.id?doc:d)}:old);}
  async function submit(){if(!batch)return;const ready=batch.documents.filter(d=>batchReady(d)&&!drafts[d.id]&&canSubmitRecord(bootstrap.user,d));if(!ready.length)return;
    setSubmitting(true);setError("");try{const result=await api.post<{results:NonNullable<typeof results>}>(endpoint,{action:"submit",documents:ready.map(d=>({id:d.id,version:d.version}))});setResults(result.results);await load();}catch(e){setError(e instanceof Error?e.message:"提交失败，请刷新后重试，已提交的不会重复提交");}finally{setSubmitting(false);}}
  async function resume(position:number,file:File){setBusyIds(old=>({...old,[`upload-${position}`]:true}));setError("");try{
    if(file.size>15*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("请选择15MB以内的JPG、PNG或WebP图片");
    const original=batch?.photos.find(p=>p.position===position);
    if(original&&file.name!==original.fileName&&!window.confirm(`原图片名为“${original.fileName}”，确认选中的是同一张单据？`))return;
    const compressed=await compressBatchImage(file);
    const result=await api.post<{target?:{url:string;headers:Record<string,string>};documentId?:string;deleted?:boolean}>(endpoint,{action:"upload-target",position,mime:compressed.type});
    if(result.target){try{await uploadToTarget(result.target.url,compressed,result.target.headers);}catch(e){if(!(e instanceof ApiClientError&&e.status===409))throw e;}await api.post(endpoint,{action:"complete",position});}
    await load();
  }catch(e){setError(e instanceof Error?e.message:"上传失败，请重试本张");}finally{setBusyIds(old=>({...old,[`upload-${position}`]:false}));}}
  if(!batch)return error?<ErrorState message={error} onRetry={load}/>:<PageLoading/>;
  const ready=batch.documents.filter(d=>batchReady(d)&&!drafts[d.id]&&canSubmitRecord(bootstrap.user,d));
  const submitted=batch.documents.filter(d=>["PENDING_REVIEW","APPROVED"].includes(d.status));
  const groups=new Map<string,DocumentDto[]>();
  for(const doc of batch.documents){
    if(filter==="pending"&&(batchReady(doc)&&!drafts[doc.id]||["PENDING_REVIEW","APPROVED"].includes(doc.status)))continue;
    const key=doc.supplierId?doc.supplierName:"待确认供应商";groups.set(key,[...(groups.get(key)||[]),doc]);
  }
  return <section className={"batch-review"+(embedded?" is-embedded":"")}>
    <div className="batch-title"><div>{!embedded&&<Link className="link-button" href="/upload">‹ 新建单据</Link>}<h1>批次核对</h1><p>{batch.projectName} · {batch.photos.length} 张独立单据</p></div><div className="batch-progress"><b>{ready.length}</b> 张可提交 <span>· 已提交 {submitted.length}</span></div></div>
    {error&&<p className="notice notice--red" role="alert">{error}<button className="link-button" onClick={load}>刷新</button></p>}
    {recovery.error&&<p className="notice notice--red">{recovery.error}</p>}
    {recoveryConflict&&<p className="notice notice--red">恢复副本与服务器版本或当前权限不一致，未自动覆盖。<button className="link-button" onClick={()=>{if(window.confirm("放弃无法恢复的旧副本，继续使用服务器最新数据？")){setRecoveryConflict(false);void recovery.write(recoveryValue());}}}>放弃冲突副本</button></p>}
    <nav className="batch-filters" aria-label="批次筛选"><button className={filter==="all"?"is-active":""} onClick={()=>setFilter("all")}>全部 {batch.photos.length}</button><button className={filter==="pending"?"is-active":""} onClick={()=>setFilter("pending")}>待处理 {batch.photos.length-ready.length-submitted.length}</button><span>点明细修改 · 每单确认后提交</span></nav>
    {batch.photos.filter(p=>!p.documentId).map(p=><article className="batch-missing" key={p.position}><strong>单据 {p.position.toString().padStart(2,"0")}</strong><span>{p.deleted?"已删除":uploading?"正在上传或等待上传":`尚未上传完成 · ${p.fileName}`}</span>{!p.deleted&&!uploading&&batch.canUpload&&<label className="btn btn--outline btn--small">{busyIds[`upload-${p.position}`]?"上传中…":"重新选择本张"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void resume(p.position,file);e.target.value="";}}/></label>}</article>)}
    {[...groups].map(([name,docs])=><section className="batch-supplier" key={name}><h2>{name}<span>{docs.length} 张</span></h2>{docs.map(server=>{
      const draft=drafts[server.id];const allowed=server.visibility?.sensitiveDetails!==false;
      const conflict=!!draft&&(draft.version<server.version||draft.status!==server.status||!canEditRecord(bootstrap.user,server)||!allowed);
      return <BatchDocumentCard key={server.id} document={draft&&allowed?draft:server} bootstrap={bootstrap} dirty={!!draft} conflict={conflict}
        onChange={doc=>setDrafts(old=>({...old,[doc.id]:doc}))} onSaved={saved}
        onBusy={value=>setBusyIds(old=>({...old,[server.id]:value}))}
        onDiscard={()=>{setDrafts(old=>{const next={...old};delete next[server.id];return next;});}}/>;
    })}</section>)}
    {!groups.size&&<p className="empty">{filter==="pending"?"当前没有待处理明细。":"图片上传完成后，识别结果会自动显示。"}</p>}
    {!embedded&&<div className="batch-submit-bar"><div><strong>{ready.length} 张已核对</strong><small>有问题的留在本批次继续处理</small></div><button className="btn btn--primary" disabled={busy||!ready.length||!!error||recoveryConflict} onClick={submit}>{submitting?"正在提交…":`提交已核对的 ${ready.length} 张`}</button></div>}
    {embedded&&<p><Link className="btn btn--primary" href={`/batches/${id}`}>进入核对并提交</Link></p>}
    {results&&<EditorSheet title="提交结果" onClose={()=>setResults(null)}><div className="batch-result-total">{results.filter(r=>r.ok).length} 张已提交审核</div><p>有问题的单据继续保留在本批次。</p>{results.map(r=><p className={r.ok?"text-success":"text-danger"} key={r.id}>单据 {batch.documents.find(d=>d.id===r.id)?.batchPosition} · {r.message}</p>)}<button className="btn btn--primary" onClick={()=>{setResults(null);setFilter("pending");}}>继续处理剩余单据</button></EditorSheet>}
  </section>;
}
