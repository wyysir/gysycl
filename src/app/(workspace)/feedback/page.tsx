"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
type FeedbackList = { canViewAll: boolean; items: { id: string; createdAt: string; author: string; content: string; contact: string }[] };
export default function FeedbackPage() {
  const [content, setContent] = useState(""), [contact, setContact] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [data, setData] = useState<FeedbackList | null>(null);
  useEffect(() => { api.get<FeedbackList>("/api/feedback").then(setData).catch(error => setMessage(error.message)); }, []);
  return <div className="feedback-page"><h1>反馈建议</h1><form className="panel card" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage("");
    try { await api.post("/api/feedback", { content, contact }); setContent(""); setContact(""); setMessage("反馈已提交"); setData(await api.get<FeedbackList>("/api/feedback")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "提交失败，请重试"); }
    finally { setBusy(false); }
  }}><label>问题或建议<textarea className="textarea" required maxLength={2000} value={content} onChange={event => setContent(event.target.value)} rows={6} placeholder="请描述操作步骤、遇到的问题或改进建议" /></label><label>联系方式（选填）<input className="input" maxLength={100} value={contact} onChange={event => setContact(event.target.value)} /></label><button className="btn btn--primary" disabled={busy || !content.trim()}>{busy ? "提交中…" : "提交反馈"}</button>{message && <p role="status">{message}</p>}</form>
    <section className="panel card"><h2>{data?.canViewAll ? "全部反馈" : "我的反馈"}（最近50条）</h2>{data ? data.items.length ? data.items.map(item => <article className="feedback-record" key={item.id}><small>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.author}</small><p>{item.content}</p>{item.contact && <small>联系方式：{item.contact}</small>}</article>) : <p>暂无反馈。</p> : <p>加载中…</p>}</section>
  </div>;
}
