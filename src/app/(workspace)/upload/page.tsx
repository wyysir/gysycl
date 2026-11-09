"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, X } from "lucide-react";
import { api, ApiClientError, uploadToTarget } from "@/lib/client/api";
import { compressBatchImage, type Batch } from "@/lib/client/batches";
import { concurrentMap } from "@/lib/client/concurrent-map";
import { hasPermission } from "@/lib/permissions";
import type { Bootstrap } from "@/lib/client/types";
import { useLocalDraft, useLeaveProtection } from "@/components/LeaveProtection";
import { EditorSheet } from "@/components/EditorSheet";
import { ErrorState, PageLoading } from "@/components/ui";
type Photo = {id:string;file:File};
type UploadDraft = {projectId:string;docDate:string;photos:Photo[];batchId:string;requestId:string};
type Recent = {id:string;projectName:string;docDate:string;count:number;uploaded:number};
function Preview({file,index}:{file:File;index:number}) {
  const [url,setUrl]=useState("");useEffect(()=>{const url=URL.createObjectURL(file);setUrl(url);return()=>{setTimeout(()=>URL.revokeObjectURL(url),0);};},[file]);
  return <img src={url||undefined} alt={`单据 ${index+1}`} />;
}
export default function UploadPage(){
  const router=useRouter();
  const [bootstrap,setBootstrap]=useState<Bootstrap|null>(null),[error,setError]=useState("");
  const [projectId,setProjectId]=useState(""),[docDate,setDocDate]=useState(new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}));
  const [photos,setPhotos]=useState<Photo[]>([]),[batchId,setBatchId]=useState(""),[requestId,setRequestId]=useState("");
  const [uploading,setUploading]=useState(false),[config,setConfig]=useState(false),[manualBusy,setManualBusy]=useState(false);
  const [states,setStates]=useState<Record<number,string>>({}),[recent,setRecent]=useState<Recent[]>([]),[progress,setProgress]=useState<Batch|null>(null);
  const album=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),replace=useRef<HTMLInputElement>(null),replaceIndex=useRef<number|null>(null);
  const busyRef=useRef(false),restored=useRef(false);const recovery=useLocalDraft<UploadDraft>("/upload");
  useEffect(()=>{
    api.get<Bootstrap>("/api/bootstrap?scope=context").then(b=>{setBootstrap(b);setProjectId(b.projects.find(p=>hasPermission(b.user,"document.create",p.id))?.id||"");}).catch(e=>setError(e.message));
    api.get<{batches:Recent[]}>("/api/batches").then(r=>setRecent(r.batches)).catch(()=>{});setRequestId(crypto.randomUUID());
  },[]);
  useEffect(()=>{if(!recovery.ready||!bootstrap||restored.current)return;restored.current=true;const saved=recovery.draft?.value;
    if(saved&&Array.isArray(saved.photos)&&bootstrap.projects.some(p=>p.id===saved.projectId&&hasPermission(bootstrap.user,"document.create",p.id))){setProjectId(saved.projectId);setDocDate(saved.docDate);setPhotos(saved.photos);setBatchId(saved.batchId);setRequestId(saved.requestId);}
  },[recovery.ready,recovery.draft,bootstrap]);
  function snapshot():UploadDraft{return {projectId,docDate,photos,batchId,requestId};}
  useEffect(()=>{if(!restored.current||!photos.length)return;const timer=setTimeout(()=>void recovery.write({projectId,docDate,photos,batchId,requestId}),500);return()=>clearTimeout(timer);},[projectId,docDate,photos,batchId,requestId,recovery.write]);
  useEffect(()=>{if(!batchId)return;let stopped=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const b=await api.get<Batch>(`/api/batches/${batchId}`);if(!stopped)setProgress(b);}catch{}if(!stopped)timer=setTimeout(poll,2500);};void poll();return()=>{stopped=true;clearTimeout(timer);};},[batchId]);
  useLeaveProtection({dirty:photos.length>0,busy:uploading||manualBusy,keep:()=>recovery.write(snapshot()),discard:async()=>{setPhotos([]);return recovery.clear();}});
  function add(files:FileList|null){if(!files||batchId||busyRef.current)return;const selected=Array.from(files);setError("");
    if(selected.some(f=>!["image/jpeg","image/png","image/webp"].includes(f.type)||f.size>15*1024*1024)){setError("请选择15MB以内的JPG、PNG或WebP图片；HEIC请先转换为JPG。");return;}
    if(replaceIndex.current!==null){const n=replaceIndex.current;setPhotos(old=>old.map((p,i)=>i===n?{id:crypto.randomUUID(),file:selected[0]}:p));replaceIndex.current=null;return;}
    if(photos.length+selected.length>10){setError("每批最多10张，请减少所选图片后重试。");return;}
    setPhotos(old=>[...old,...selected.map(file=>({id:crypto.randomUUID(),file}))]);
  }
  async function start(){if(busyRef.current||!photos.length||!projectId||!requestId)return;busyRef.current=true;setUploading(true);setError("");let id=batchId;
    try{
      if(!id){const result=await api.post<{id:string}>("/api/batches",{requestId,projectId,docDate,fileNames:photos.map(p=>p.file.name)});id=result.id;setBatchId(id);}
      await recovery.write({...snapshot(),batchId:id});
      let failures=0;
      await concurrentMap(photos,2,async(photo,index)=>{
        const position=index+1;if(states[position]==="已上传")return;
        try{
          setStates(old=>({...old,[position]:"准备图片"}));const file=await compressBatchImage(photo.file);
          const result=await api.post<{target?:{url:string;headers:Record<string,string>};documentId?:string;deleted?:boolean}>(`/api/batches/${id}`,{action:"upload-target",position,mime:file.type});
          if(result.deleted)throw new Error("单据已删除，请另建批次");
          if(result.target){try{await uploadToTarget(result.target.url,file,result.target.headers,n=>setStates(old=>({...old,[position]:`上传 ${n}%`})));}catch(e){if(!(e instanceof ApiClientError&&e.status===409))throw e;}}
          await api.post(`/api/batches/${id}`,{action:"complete",position});setStates(old=>({...old,[position]:"已上传"}));
        }catch(e){failures++;setStates(old=>({...old,[position]:e instanceof Error?e.message:"上传失败"}));}
      });
      if(!failures){await recovery.clear();setPhotos([]);router.push(`/batches/${id}`);}else setError(`${failures} 张上传未完成。已上传的正在独立识别，可重试剩余图片。`);
    }catch(e){setError(e instanceof Error?e.message:"上传未完成，请重试");}finally{busyRef.current=false;setUploading(false);}
  }
  async function manual(){if(!projectId||busyRef.current)return;setManualBusy(true);try{const result=await api.post<{id:string}>("/api/documents",{entryMode:"MANUAL",projectId,docDate});router.push(`/documents/${result.id}`);}catch(e){setError(e instanceof Error?e.message:"创建失败");}finally{setManualBusy(false);}}
  if(!bootstrap)return error?<ErrorState message={error} onRetry={()=>window.location.reload()}/>:<PageLoading/>;
  const projects=bootstrap.projects.filter(p=>hasPermission(bootstrap.user,"document.create",p.id)),canOcr=hasPermission(bootstrap.user,"document.ocr",projectId);
  return <section className="batch-upload"><div className="batch-title"><div><Link href="/dashboard" className="link-button">‹ 工作台</Link><h1>拍照录入</h1><p>一次最多 10 张 · 每张独立识别、关联原图</p></div></div>
    <button className="batch-project-choice" onClick={()=>setConfig(true)} disabled={uploading||!!batchId}><div><small>本批次项目点</small><strong>{projects.find(p=>p.id===projectId)?.name||"请选择项目点"}</strong><span>备用日期 {docDate} · 优先使用原单日期</span></div><b>选择 ›</b></button>
    <div className="batch-pick"><button className="btn btn--primary" disabled={!canOcr||!!batchId||uploading||photos.length>=10} onClick={()=>camera.current?.click()}><Camera size={20}/>拍照</button><button className="btn btn--outline" disabled={!canOcr||!!batchId||uploading||photos.length>=10} onClick={()=>album.current?.click()}><ImagePlus size={20}/>从相册选择</button></div>
    <input hidden ref={camera} type="file" capture="environment" accept="image/jpeg,image/png,image/webp" onChange={e=>{add(e.target.files);e.target.value="";}}/>
    <input hidden ref={album} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{add(e.target.files);e.target.value="";}}/>
    <input hidden ref={replace} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{add(e.target.files);e.target.value="";replaceIndex.current=null;}}/>
    <div className="batch-upload-count"><strong>已选 {photos.length} / 10 张</strong><span>同属一个项目点</span></div>
    <div className="batch-photo-grid">{photos.map((photo,index)=><article className="batch-photo" key={photo.id}><button disabled={!!batchId||uploading} onClick={()=>{replaceIndex.current=index;replace.current?.click();}} aria-label={`更换第${index+1}张图片`}><Preview file={photo.file} index={index}/></button><b>{String(index+1).padStart(2,"0")}</b>{!batchId&&<button className="batch-photo-remove" disabled={uploading} aria-label={`移除第${index+1}张`} onClick={()=>setPhotos(old=>old.filter(p=>p.id!==photo.id))}><X size={14}/></button>}<small>{states[index+1]||photo.file.name}</small></article>)}</div>
    {!photos.length&&<div className="batch-empty"><Camera size={40}/><p>拍清整张单据，尽量摆正、避开反光。</p><small>支持 JPG、PNG、WebP；每张不超过15MB</small></div>}
    {progress&&<p className="notice" role="status">已上传 {progress.documents.length}/{progress.photos.length} 张 · 已返回识别结果 {progress.documents.filter(d=>d.status!=="PROCESSING").length} 张</p>}
    {error&&<p className="notice notice--red" role="alert">{error}</p>}{recovery.error&&<p className="notice notice--red">{recovery.error}</p>}
    <p className="text-muted">上传后的单据可随时继续核对。未上传完的图片，关闭微信后可能需要重新选择。</p>
    <div className="batch-upload-actions"><button className="btn btn--primary" disabled={!canOcr||uploading||!photos.length||!recovery.ready} onClick={start}>{uploading?"正在上传并识别…":batchId?"重试未完成的图片":`开始识别 ${photos.length} 张`}</button>{batchId&&!uploading&&<Link className="btn btn--outline" href={`/batches/${batchId}`}>先核对已上传单据</Link>}{!photos.length&&!batchId&&<button className="link-button" disabled={!projectId||manualBusy} onClick={manual}>手工录入单据</button>}</div>
    {!!recent.length&&<section className="batch-recent"><h2>最近批次</h2>{recent.slice(0,8).map(b=><Link href={`/batches/${b.id}`} key={b.id}><span><strong>{b.projectName}</strong><small>{b.docDate} · {b.count} 张</small></span><span>继续核对 ›</span></Link>)}</section>}
    {config&&<EditorSheet title="选择项目与备用日期" onClose={()=>setConfig(false)}><label className="field">项目点<select className="select" value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">原单没有完整日期时使用<input className="input" type="date" value={docDate} onChange={e=>setDocDate(e.target.value)}/></label><p>识别到原单完整日期时优先采用；核对时可逐张修改。</p><button className="btn btn--primary" onClick={()=>setConfig(false)}>确定</button></EditorSheet>}
  </section>;
}
