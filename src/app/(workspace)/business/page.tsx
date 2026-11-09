"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { ErrorState, PageLoading, formatMoney } from "@/components/ui";
import { EditorSheet } from "@/components/EditorSheet";
import { useToast } from "@/components/ToastProvider";
import type { getBusiness } from "@/server/business";

type Business=Awaited<ReturnType<typeof getBusiness>>;
const money=(n:number|null)=>n===null?"待补全 / 待审核":`¥${formatMoney(n)}`;
const statusLabel=(status:string)=>status==="APPROVED"?"已通过":status==="NEEDS_REVISION"?"已退回":"待审核";
const colors=["#76543e","#a77d56","#c5a47e","#dfc69f","#d5cabc","#9caaa0","#768d86","#b5a095"];
export default function BusinessPage() {
  const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"});
  const [filters,setFilters]=useState({from:new Date(Date.now()-6*86400000).toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}),to:today,projectId:""});
  const [data,setData]=useState<Business|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  const [edit,setEdit]=useState({projectId:"",date:today,amount:"",notes:"",version:0});
  const [review,setReview]=useState<{id:string;version:number;action:"approve"|"return";name:string;amount:number;date:string}|null>(null);
  const [reviewNote,setReviewNote]=useState(""),[lookupBusy,setLookupBusy]=useState(false),[lookupError,setLookupError]=useState("");
  const [loading,setLoading]=useState(false);
  const loadSequence=useRef(0),editSequence=useRef(0);
  const [point,setPoint]=useState(0),[category,setCategory]=useState("");
  const {showToast}=useToast();
  async function load(query=filters){const seq=++loadSequence.current;setLoading(true);try{setError("");const result=await api.get<Business>("/api/business?"+new URLSearchParams(query));if(seq!==loadSequence.current)return;setData(result);setPoint(result.summary.daily.length-1);}catch(e){if(seq===loadSequence.current)setError(e instanceof Error?e.message:"加载失败");}finally{if(seq===loadSequence.current)setLoading(false);}}
  useEffect(()=>{load();},[]);
  async function selectEdit(projectId:string,date:string){
    const seq=++editSequence.current;setEdit({projectId,date,amount:"",notes:"",version:0});setLookupError("");setLookupBusy(true);
    try{const result=await api.get<Business>("/api/business?"+new URLSearchParams({projectId,from:date,to:date}));if(seq!==editSequence.current)return;const row=result.revenues.find(r=>r.projectId===projectId&&r.date===date);setEdit({projectId,date,amount:row?String(row.amount):"",notes:row?.notes||"",version:row?.version||0});}
    catch(e){if(seq===editSequence.current)setLookupError(e instanceof Error?e.message:"读取营业额失败");}
    finally{if(seq===editSequence.current)setLookupBusy(false);}
  }
  async function save(){if(busy||lookupBusy||lookupError)return;if(!edit.amount.trim()){showToast("请填写营业额，未营业可填0","error");return;}setBusy(true);try{await api.patch("/api/business",{...edit,amount:Number(edit.amount)});setOpen(false);showToast("营业额已提交审核");await load();}catch(e){showToast(e instanceof Error?e.message:"保存失败","error");}finally{setBusy(false);}}
  async function submitReview(){if(!review||busy)return;if(review.action==="return"&&!reviewNote.trim()){showToast("退回营业额必须填写原因","error");return;}setBusy(true);try{await api.post("/api/business/review",{id:review.id,version:review.version,action:review.action,note:reviewNote});showToast(review.action==="approve"?"营业额审核已通过":"营业额已退回");setReview(null);await load();}catch(e){showToast(e instanceof Error?e.message:"审核失败","error");}finally{setBusy(false);}}
  function enterProject(projectId:string){const query={...filters,projectId};setFilters(query);void load(query);}
  if(error&&!data)return <ErrorState message={error} onRetry={load}/>;
  if(!data)return <PageLoading label="正在汇总项目经营…"/>;
  const selectedProject=data.projects.find(p=>p.id===data.projectId);
  const filterForm=<form className="card toolbar business-filters" onSubmit={e=>{e.preventDefault();load();}} aria-label="经营日期筛选">
    <label className="field">开始日期<input className="input" type="date" required value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
    <label className="field">结束日期<input className="input" type="date" required value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
    <button className="btn btn--primary" disabled={loading}>{loading?"查询中…":"查询"}</button>
  </form>;
  if(loading&&data.projectId!==filters.projectId)return <div className="page business-page"><PageLoading label="正在读取项目经营…"/></div>;
  if(!data.projectId)return <div className="page business-page">
    <div className="page-head"><div><h1 className="page-title">项目经营</h1><p className="page-subtitle">选择项目点，查看经营数据并录入、审核营业额</p></div></div>
    {filterForm}{error&&<p role="alert" className="notice notice--red">{error}</p>}
    <div className="business-project-grid">{data.projectCards.map(p=><button key={p.id} className="card business-project-card" onClick={()=>enterProject(p.id)}>
      <h2>{p.name}</h2><span className="text-muted">{data.from} — {data.to}</span>
      <dl><div><dt>已审核营业额</dt><dd>{money(p.revenue)}</dd></div><div><dt>原材料金额</dt><dd>{p.cost===null?"无分析权限":money(p.cost)}</dd></div></dl>
      <p>{p.pending} 笔待审核{p.returned>0?` · ${p.returned} 笔已退回`:""}<span>进入项目 →</span></p>
    </button>)}</div>{!data.projects.length&&<p className="notice">暂无已授权项目点，请联系管理员配置项目权限。</p>}
  </div>;
  const days=data.summary.daily;
  const rates=days.flatMap(d=>d.rate===null?[]:[d.rate]);
  const min=Math.min(0,...rates),max=Math.max(100,...rates),height=190;
  const x=(i:number)=>48+i*(650/Math.max(1,days.length-1)),y=(rate:number)=>25+(max-rate)/(max-min)*height;
  let path="",previous=false;days.forEach((day,i)=>{if(day.rate===null){previous=false;return;}path+=`${previous?"L":"M"}${x(i)},${y(day.rate)} `;previous=true;});
  const active=days[point];const editProject=data.projects.find(p=>p.id===edit.projectId);
  const editable=edit.date===today?editProject?.editToday:edit.date<today&&editProject?.editHistory;
  let angle=0;
  const activeCategory=data.categories.find(c=>c.name===category);
  return <div className="page business-page">
    <div className="page-head"><div><button className="link-button" onClick={()=>enterProject("")}>← 返回项目列表</button><h1 className="page-title">{selectedProject?.name}</h1><p className="page-subtitle">项目经营 · {data.from} — {data.to}</p></div>{selectedProject&&(selectedProject.editToday||selectedProject.editHistory)&&<button className="btn btn--primary" disabled={loading} onClick={()=>{void selectEdit(data.projectId,today);setOpen(true);}}>录入今日营业额</button>}</div>
    {filterForm}
    {error&&<p className="notice notice--red" role="alert">{error}</p>}
    {data.excludedProjects>0&&<p className="notice">{data.excludedProjects}个项目缺少完整分析权限，图表已排除；营业额记录按授权显示。</p>}
    {data.analysisProjectCount>0?<><section className="business-stats card"><div>已审核营业额<strong>{money(data.summary.revenue)}</strong></div><div>原材料金额<strong>{money(data.summary.cost)}</strong><small>含待审核 {money(data.summary.pending)}</small></div><div>期间采购口径毛利率<strong>{data.summary.rate===null?"待补全":`${data.summary.rate}%`}</strong><small>{data.summary.incomplete?"存在有采购但营业额未补全或未审核的日期":"按期间合计计算"}</small></div></section>
    <p className="text-muted">采购按单据日期及明细实际金额统计，包含已通过和待审核（暂估）；不扣减第二次抹零。不含库存变化、人工、租金，不能替代财务毛利。</p>
    {!!data.sourceDifference&&<p className="notice">单据总额与明细合计相差 {money(data.sourceDifference)}，图表采用明细金额，差额未摊入分类。</p>}
    <section className="card"><div className="card-head"><div><h2 className="card-title">采购口径毛利率曲线</h2><p className="card-subtitle">悬停、点选或键盘聚焦圆点查看当天数据；未填、未审核或0营业额处断开</p></div></div><div className="business-chart"><svg viewBox="0 0 740 265" role="img" aria-label="每日采购口径毛利率曲线">
      {[min,(min+max)/2,max].map(v=><g key={v}><line x1="48" x2="710" y1={y(v)} y2={y(v)} stroke="#e5ddd4"/><text x="3" y={y(v)+4} fontSize="12" fill="#786d62">{Math.round(v)}%</text></g>)}
      <path d={path} stroke="#76543e" strokeWidth="3" fill="none"/>
      {days.map((day,i)=><g key={day.date}>{day.rate!==null&&<circle cx={x(i)} cy={y(day.rate)} r={point===i?6:4} fill="#76543e" tabIndex={0} role="button" aria-label={`${day.date} 毛利率${day.rate}%`} onMouseEnter={()=>setPoint(i)} onFocus={()=>setPoint(i)} onClick={()=>setPoint(i)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setPoint(i);}}><title>{`${day.date} 营业额${money(day.revenue)} 原材料${money(day.cost)} 待审核${money(day.pending)} 毛利${money(day.profit)} 毛利率${day.rate}%`}</title></circle>}{(i===0||i===days.length-1||days.length<=8)&&<text x={x(i)} y="245" textAnchor="middle" fontSize="12" fill="#786d62">{day.date.slice(5)}</text>}</g>)}
    </svg></div>{active&&<div className="business-tooltip" aria-live="polite"><strong>{active.date}</strong><span>营业额 {money(active.revenue)}</span><span>原材料 {money(active.cost)}（待审核 {money(active.pending)}）</span><span>毛利 {money(active.profit)} · {active.rate===null?active.revenue===0?"零营业额，无法计算比率":"营业额未补全或未审核，无法计算比率":`${active.rate}%`}</span>{!active.documents&&<span>暂无采购记录</span>}</div>}
    <div className="business-day-picker">{days.map((d,i)=><button className={point===i?"is-active":""} key={d.date} onClick={()=>setPoint(i)}>{d.date.slice(5)}{d.rate===null?" · 待补":""}</button>)}</div></section>
    <section className="card"><div className="card-head"><h2 className="card-title">原材料分类占比</h2><span className="text-muted">按材料当前分类统计</span></div><div className="category-layout"><svg viewBox="0 0 240 240" role="img" aria-label="原材料分类金额占比"><circle cx="120" cy="120" r="80" fill="none" stroke="#ece7df" strokeWidth="32"/>{data.categories.filter(c=>c.amount>0).map((c,i)=>{const length=c.amount/data.summary.cost*100;const offset=angle;angle+=length;return <circle key={c.name} cx="120" cy="120" r="80" pathLength="100" fill="none" stroke={colors[i%colors.length]} strokeWidth={category===c.name?38:32} strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-offset} transform="rotate(-90 120 120)" tabIndex={0} role="button" aria-label={`${c.name} ${c.ratio}% ${money(c.amount)}`} onMouseEnter={()=>setCategory(c.name)} onFocus={()=>setCategory(c.name)} onClick={()=>setCategory(c.name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setCategory(c.name);}}><title>{`${c.name} ${c.ratio}% 金额${money(c.amount)} 待审核${money(c.pending)}`}</title></circle>;})}<text x="120" y="116" textAnchor="middle" fill="#786d62" fontSize="14">原材料合计</text><text x="120" y="141" textAnchor="middle" fill="#44372c" fontSize="18">{formatMoney(data.summary.cost)}</text></svg><div className="category-list">{data.categories.map((c,i)=><button key={c.name} className="ledger-pair" onMouseEnter={()=>setCategory(c.name)} onFocus={()=>setCategory(c.name)} onClick={()=>setCategory(c.name)}><span><i style={{background:colors[i%colors.length]}}/>{c.name}</span><span>{money(c.amount)} · {c.ratio}%</span></button>)}{!data.categories.length&&<p>暂无采购记录</p>}{activeCategory&&<p className="business-tooltip" aria-live="polite">{activeCategory.name} · {activeCategory.ratio}% · {money(activeCategory.amount)} · 待审核 {money(activeCategory.pending)}</p>}</div></div></section>
    </>:<p className="notice">已审核营业额 {money(data.projectCards[0]?.revenue??0)}；缺少完整分析权限，暂不显示采购金额和毛利率图表。</p>}
    <section className="card"><div className="card-head"><h2 className="card-title">每日营业额记录</h2><span className="text-muted">{data.revenueReview.pendingCount} 笔待审核 · {data.revenueReview.returnedCount} 笔已退回</span></div>
      <p className="notice">录入后须审核通过才计入营业额和毛利率；修改已通过记录会重新提交审核。</p>
      <div className="revenue-records">{data.revenues.map(r=>{const p=data.projects.find(p=>p.id===r.projectId)!;return <article className="revenue-record" key={r.id}>
        <div className="revenue-record-head"><time dateTime={r.date}>{r.date}</time><span className={`revenue-status revenue-status--${r.status.toLowerCase()}`}>{statusLabel(r.status)}</span><strong>{money(r.amount)}</strong></div>
        {r.notes&&<p>{r.notes}</p>}{r.reviewNote&&<p className="notice">审核意见：{r.reviewNote}</p>}
        <div className="revenue-record-actions">{(r.date===today?p.editToday:p.editHistory)&&<button className="btn btn--ghost" disabled={busy||loading} onClick={()=>{void selectEdit(r.projectId,r.date);setOpen(true);}}>修改</button>}
        {r.status==="PENDING_REVIEW"&&(["approve","return"] as const).map(action=>p[action]&&<button key={action} className={`btn ${action==="approve"?"btn--primary":"btn--ghost"}`} disabled={busy||loading} onClick={()=>{setReview({id:r.id,version:r.version,action,name:p.name,amount:r.amount,date:r.date});setReviewNote("");}}>{action==="approve"?"审核通过":"退回"}</button>)}</div>
      </article>;})}{!data.revenues.length&&<p className="text-muted">暂无营业额，使用上方按钮录入</p>}</div>
    </section>
    {open&&<EditorSheet title="项目每日营业额" onClose={()=>{if(!busy){editSequence.current++;setOpen(false);}}}><form className="revenue-form" onSubmit={e=>{e.preventDefault();save();}}>
      <p className="notice">{selectedProject?.name} · 同一项目同一天仅一笔总营业额，保存后进入待审核；已通过记录修改后须重新审核。</p>
      <label className="field">营业日期<input className="input" type="date" required disabled={busy} max={today} min={editProject?.editHistory?undefined:today} value={edit.date} onChange={e=>void selectEdit(edit.projectId,e.target.value)}/></label>
      {lookupBusy&&<p role="status">正在读取该日期的营业额…</p>}{lookupError&&<p role="alert" className="notice notice--red">{lookupError}<button type="button" className="link-button" onClick={()=>void selectEdit(edit.projectId,edit.date)}>重试</button></p>}
      <label className="field">当日总营业额（元）<input className="input" inputMode="decimal" type="number" min="0" step="0.01" required disabled={busy||lookupBusy||!!lookupError} value={edit.amount} onChange={e=>setEdit({...edit,amount:e.target.value})}/></label>
      <label className="field">备注{edit.date!==today?" / 历史修改原因（必填）":""}<textarea className="textarea" required={edit.date!==today} disabled={busy||lookupBusy||!!lookupError} maxLength={2000} value={edit.notes} onChange={e=>setEdit({...edit,notes:e.target.value})}/></label>
      <button className="btn btn--primary" disabled={busy||lookupBusy||!!lookupError||!editable}>{busy?"提交中…":"保存并提交审核"}</button>
    </form></EditorSheet>}
    {review&&<EditorSheet title={review.action==="approve"?"审核营业额":"退回营业额"} onClose={()=>{if(!busy)setReview(null);}}><form className="revenue-form" onSubmit={e=>{e.preventDefault();void submitReview();}}>
      <p>{review.name} · {review.date}</p><strong>{money(review.amount)}</strong>
      <label className="field">审核意见{review.action==="return"?"（必填）":"（可选）"}<textarea className="textarea" required={review.action==="return"} disabled={busy} maxLength={2000} value={reviewNote} onChange={e=>setReviewNote(e.target.value)}/></label>
      <button className="btn btn--primary" disabled={busy}>{busy?"提交中…":review.action==="approve"?"确认通过":"确认退回"}</button>
    </form></EditorSheet>}
  </div>;
}
