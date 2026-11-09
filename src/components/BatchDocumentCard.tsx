"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client/api";
import type { Bootstrap, DocumentDto, DocumentItem, SupplierSuggestion } from "@/lib/client/types";
import { batchReady } from "@/lib/client/batches";
import { currentItemChecks } from "@/lib/client/item-checks";
import { canEditRecord, canSubmitRecord, hasPermission } from "@/lib/permissions";
import { DocumentItemsEditor } from "./DocumentItemsEditor";
import { DocumentImage } from "./DocumentImage";
import { EditorSheet } from "./EditorSheet";
import { AmountInput } from "./AmountInput";
import { formatMoney } from "./ui";

export function BatchDocumentCard({document:doc,bootstrap,dirty,conflict,onChange,onSaved,onBusy,onDiscard}:{
  document:DocumentDto;bootstrap:Bootstrap;dirty:boolean;conflict:boolean;
  onChange:(doc:DocumentDto)=>void;onSaved:(doc:DocumentDto)=>void;onBusy:(busy:boolean)=>void;onDiscard:()=>void;
}) {
  const [busy,setBusy]=useState(false), [error,setError]=useState("");
  const [modal,setModal]=useState<"supplier"|"info"|"image"|null>(null);
  const [newItem,setNewItem]=useState<{index:number;name:string;unit:string;category:string}|null>(null);
  const [candidate,setCandidate]=useState<{id:string;name:string;unit:string;spec:string}|null>(null);
  const [q,setQ]=useState(""),[suppliers,setSuppliers]=useState<SupplierSuggestion[]>([]);
  const editable=canEditRecord(bootstrap.user,doc)&&["DRAFT","NEEDS_REVISION"].includes(doc.status)&&!conflict&&!busy;
  const submittable=canSubmitRecord(bootstrap.user,doc)&&!conflict;
  const canCreate=hasPermission(bootstrap.user,"master.create",doc.projectId);
  const checks=currentItemChecks(doc.checks,doc.items);
  const severe=checks.filter(c=>c.status==="OPEN"&&c.severity==="ERROR");
  const source=doc.pages[0];
  const ready=batchReady(doc)&&!dirty;
  useEffect(()=>{if(modal!=="supplier")return;let current=true;const timer=setTimeout(()=>{
    api.get<{suggestions:SupplierSuggestion[]}>("/api/master-data/suggest?type=supplier&q="+encodeURIComponent(q)).then(r=>{if(current)setSuppliers(r.suggestions);}).catch(e=>{if(current)setError(e.message);});
  },200);return()=>{current=false;clearTimeout(timer);};},[q,modal]);
  function patch(value:Partial<DocumentDto>){onChange({...doc,...value,checkedVersion:null});}
  function patchItem(index:number,value:Partial<DocumentItem>){patch({items:doc.items.map((i,n)=>n===index?{...i,...value}:i)});}
  async function run<T>(operation:()=>Promise<T>):Promise<T|null>{setBusy(true);onBusy(true);setError("");try{return await operation();}catch(e){setError(e instanceof Error?e.message:"操作未完成，请重试");return null;}finally{setBusy(false);onBusy(false);}}
  async function persist(){
    const result=await api.patch<{document:DocumentDto}>(`/api/documents/${doc.id}`,{
      ...doc,items:doc.items.map(i=>({...i,quantity:Number(i.quantity)})),
    });
    onSaved(result.document);return result.document;
  }
  async function save(){return !!await run(persist);}
  async function confirm(){await run(async()=>{
    const saved=dirty?await persist():doc;
    const result=await api.post<{document:DocumentDto}>(`/api/batches/${doc.batchId}`,{action:"confirm",documentId:doc.id,version:saved.version});
    onSaved(result.document);
  });}
  async function createSupplier(){await run(async()=>{
    const created=await api.post<{id:string;name:string;documentVersion:number}>("/api/master-data/suppliers",{name:q.trim(),rawName:doc.ocrSupplierName,sourceDocumentId:doc.id,confirmNew:true});
    patch({supplierId:created.id,supplierName:created.name,supplierMatchStatus:"MATCHED",supplierMatchScore:1,version:created.documentVersion});setModal(null);
  });}
  async function createMaterial(){if(!newItem)return;await run(async()=>{
    try {
      const created=await api.post<{id:string;name:string;unit:string;spec:string;documentVersion:number|null}>("/api/master-data/ingredients",{
        name:newItem.name,rawName:doc.items[newItem.index].rawName,unit:newItem.unit,spec:newItem.unit,category:newItem.category,
        sourceDocumentId:doc.id,sourceItemId:doc.items[newItem.index].id.startsWith("new-")?undefined:doc.items[newItem.index].id,confirmNew:true,
      });
      onChange({...doc,version:created.documentVersion??doc.version,checkedVersion:null,items:doc.items.map((i,n)=>n===newItem.index?{...i,ingredientId:created.id,name:created.name,unit:created.unit,spec:created.spec,matchStatus:"MATCHED",matchScore:1}:i)});
      setNewItem(null);setCandidate(null);
    }catch(e){if(e instanceof ApiClientError && e.status===409 && e.details && typeof e.details==="object" && "candidate" in e.details)setCandidate((e.details as {candidate:typeof candidate}).candidate);throw e;}
  });}
  const image=<>{source&&<DocumentImage src={source.url} alt={`第${doc.batchPosition}张单据原图`}/>}<button className="link-button" onClick={()=>setModal("image")}>放大查看原图</button></>;
  return <article className={"batch-document"+(ready?" is-checked":"")} id={`document-${doc.id}`}>
    <header className="batch-document-head"><div><strong>单据 {String(doc.batchPosition||1).padStart(2,"0")}</strong><span>{doc.docDate}</span><small>{source?.sourceDocDate ? "原单日期" : "所选日期 · 可修改"}</small></div>
      <div>{source&&<button className="btn btn--outline btn--small" onClick={()=>setModal("image")}>原图</button>}<button className="link-button" onClick={()=>setModal("info")}>详情</button></div>
    </header>
    <div className="batch-document-meta"><button className="link-button" disabled={!editable} onClick={()=>{setQ(doc.supplierName||doc.ocrSupplierName);setModal("supplier");setError("");}}>{doc.supplierName||"确认供应商"}{!doc.supplierId?" · 待关联":""} {editable?" ›":""}</button><span className={"pill pill--"+(ready||doc.status==="APPROVED"?"approved":"draft")}>{dirty?"有未保存修改":ready?"已核对":doc.status==="PROCESSING"?"识别中":doc.status==="PENDING_REVIEW"?"待主管审核":doc.status==="APPROVED"?"已通过":"待核对"}</span></div>
    {conflict&&<div className="notice notice--red">单据版本或权限已变化，保留的修改尚未覆盖服务器。<button className="link-button" onClick={onDiscard}>放弃本地修改，载入最新单据</button></div>}
    {doc.status==="PROCESSING"?<div className="batch-processing" role="status">正在识别本张，其他单据可继续核对。<button className="link-button" disabled={busy||!hasPermission(bootstrap.user,"document.ocr",doc.projectId)} onClick={()=>run(async()=>{await api.post(`/api/documents/${doc.id}/ocr`);})}>超过5分钟未完成？重试本张</button></div>:<>
      {doc.ocrError&&<div className="notice notice--red"><span>识别未完成：{doc.ocrError}</span>{editable&&hasPermission(bootstrap.user,"document.ocr",doc.projectId)&&<button className="btn btn--outline btn--small" onClick={()=>{if(window.confirm("仅重新识别此图片，将覆盖本单已录入的明细，是否继续？"))run(async()=>{await api.post(`/api/documents/${doc.id}/ocr`);});}}>重试本张</button>}</div>}
      <DocumentItemsEditor batch items={doc.items} editable={editable} canCreate={canCreate} threshold={bootstrap.system.confidenceThreshold}
        checks={checks} onChange={patchItem} onRemove={index=>patch({items:doc.items.filter((_,n)=>n!==index)})}
        onAdd={()=>patch({items:[...doc.items,{id:"new-"+crypto.randomUUID(),lineNo:doc.items.length+1,rawName:"",name:"",spec:"",unit:"",quantity:0,unitPrice:doc.visibility?.unitPrice===false?null:0,amount:doc.visibility?.amount===false?null:0,confidence:1,ingredientId:null,matchStatus:"UNMATCHED",matchScore:null}]})}
        onNew={index=>{setNewItem({index,name:doc.items[index].name,unit:doc.items[index].unit,category:""});setCandidate(null);setError("");}}
        onSourcePage={source?()=>setModal("image"):undefined} sourcePreview={source?image:undefined}
        externalModalOpen={!!modal||!!newItem} onSave={save} saveError={error}/>
      {severe.length>0&&<details className="batch-problems"><summary>{severe.length} 项需处理{dirty?"（保存后重新检查）":""}</summary>{severe.map(c=><p key={c.id}>{c.title}：{c.detail}</p>)}</details>}
      <footer className="batch-document-foot"><span>原单合计 <b>{formatMoney(doc.totalAmount)}</b></span><div>{dirty&&<button className="btn btn--outline btn--small" disabled={busy||conflict} onClick={save}>保存修改</button>}{submittable&&<button className="btn btn--primary btn--small" disabled={busy||ready} onClick={confirm}>{ready?"✓ 已核对":"确认本单"}</button>}</div></footer>
    </>}
    {error&&!modal&&!newItem&&<p className="text-danger batch-error" role="alert">{error}</p>}
    {modal==="image"&&source&&<EditorSheet title={`单据 ${doc.batchPosition} · 原图`} className="batch-image-sheet" onClose={()=>setModal(null)}><div className="batch-full-image"><DocumentImage src={source.url} alt="原单图片，可放大查看"/></div><p>手机可双指缩放；关闭后继续本行。</p></EditorSheet>}
    {modal==="info"&&<EditorSheet title="单据详情" onClose={()=>{if(!busy)setModal(null);}}>
      <p className="text-muted">单号：{doc.docNo}</p><label className="field">单据日期<input className="input" type="date" value={doc.docDate} disabled={!editable} onChange={e=>patch({docDate:e.target.value})}/></label>
      {source?.sourceDocDate&&<p className="text-muted">原单识别日期：{source.sourceDocDate}</p>}
      {doc.totalAmount!==null&&<label className="field">原单合计（元）<AmountInput className="input" value={doc.totalAmount} disabled={!editable} min="0" onValueChange={value=>patch({totalAmount:value})}/></label>}
      {doc.visibility?.sensitiveDetails!==false&&<label className="field">备注<textarea className="input" value={doc.notes} disabled={!editable} maxLength={2000} onChange={e=>patch({notes:e.target.value})}/></label>}
      {editable&&<button className="btn btn--primary" onClick={async()=>{if(await save())setModal(null);}}>保存详情</button>}
      <p><Link href={`/documents/${doc.id}`}>查看完整比对与审核记录</Link></p>{error&&<p role="alert" className="text-danger">{error}</p>}
    </EditorSheet>}
    {modal==="supplier"&&<EditorSheet title="确认供应商" onClose={()=>{if(!busy)setModal(null);}}>
      <p>原单：{doc.ocrSupplierName||"未识别到供应商"}</p><label className="field">查找或输入名称<input className="input" value={q} disabled={busy} onChange={e=>setQ(e.target.value)} /></label>
      <div className="batch-candidates">{suppliers.map(s=><button className="picker-result" key={s.id} disabled={busy} onClick={()=>{patch({supplierId:s.id,supplierName:s.name,supplierMatchStatus:"MATCHED",supplierMatchScore:1});setModal(null);}}><strong>{s.name}</strong><span>关联</span></button>)}</div>
      {canCreate&&<button className="btn btn--primary" disabled={busy||!q.trim()} onClick={createSupplier}>确认新建“{q.trim()||"供应商"}”</button>}{error&&<p role="alert" className="text-danger">{error}</p>}
    </EditorSheet>}
    {newItem&&<EditorSheet title="新建并关联材料" onClose={()=>{if(!busy)setNewItem(null);}}>
      {([['name','材料名称'],['unit','单位'],['category','分类']] as const).map(([key,label])=><label className="field" key={key}>{label}<input className="input" disabled={busy} value={newItem[key]} onChange={e=>setNewItem({...newItem,[key]:e.target.value})}/></label>)}
      <button className="btn btn--primary" disabled={busy||!newItem.name.trim()||!newItem.unit.trim()} onClick={createMaterial}>确认新建并关联</button>
      {error&&<p role="alert" className="text-danger">{error}</p>}{candidate&&<button className="btn btn--outline" onClick={()=>{patchItem(newItem.index,{ingredientId:candidate.id,name:candidate.name,unit:candidate.unit,spec:candidate.spec,matchStatus:"MATCHED",matchScore:1});setNewItem(null);setError("");}}>关联已有材料：{candidate.name}（{candidate.unit}）</button>}
    </EditorSheet>}
  </article>;
}
