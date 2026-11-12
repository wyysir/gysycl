"use client";

import { hasPermission } from "@/lib/permissions";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, FileText, Plus, RotateCcw, Clock3, Coins } from "lucide-react";
import { api } from "@/lib/client/api";
import type { DocumentListItem, User } from "@/lib/client/types";
import { ErrorState, PageLoading, StatusPill, formatDate, formatMoney } from "@/components/ui";
type Dashboard = {
  user: User;
  counters: { total: number; pendingReview: number; needsRevision: number; draft: number; approved: number; openErrors: number; openWarnings: number; monthSpend: number | null };
  recent: DocumentListItem[]; priority: DocumentListItem[];
  trend: Array<{ month: string; amount: number }>;
  projectSpend: Array<{ name: string; amount: number }>;
};
export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState("");
  function load() { setError(""); api.get<Dashboard>("/api/dashboard").then(setData).catch(e => setError(e instanceof Error ? e.message : "加载失败")); }
  useEffect(load, []);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <PageLoading label="正在整理工作台…" />;
  const { user, counters } = data;
  const canSubmit = hasPermission(user,"document.create");
  const canReview = hasPermission(user,"document.approve") || hasPermission(user,"document.return");
  function rows(items: DocumentListItem[], recent = false) {
    return items.map(doc => {
      const review = doc.status === "PENDING_REVIEW" && (hasPermission(user,"document.approve",doc.projectId) || hasPermission(user,"document.return",doc.projectId));
      const action = review ? "核对并审核" : doc.status === "NEEDS_REVISION" ? "查看原因" : doc.status === "DRAFT" && canSubmit ? "继续核对" : "查看详情";
      return <tr key={doc.id}>

        <td className="mobile-supplier"><strong>{doc.supplierName || "供应商待确认"}</strong><small className="ledger-meta mobile-row-meta">{doc.projectName} · {formatDate(doc.docDate)}</small></td>
        <td className="desktop-col">{doc.projectName}</td>{recent && <td className="desktop-col">{formatDate(doc.docDate)}</td>}
        <td><StatusPill status={doc.status} /></td><td className="money">{formatMoney(doc.totalAmount, hasPermission(user,"document.view_amount",doc.projectId))}</td>
        {!recent && <td>{doc.errorCount ? <span className="text-danger">{doc.errorCount}项严重异常</span> : doc.warningCount ? <span className="text-warning">{doc.warningCount}项提醒</span> : doc.status === "DRAFT" ? "继续核对明细" : "—"}</td>}
        <td><Link className={"btn btn--small " + (review ? "btn--primary" : "btn--outline")} href={"/documents/" + doc.id + "?from=dashboard"}>{action}</Link></td>
      </tr>;
    });
  }
  return <div className="page workbench">
    <div className="page-head"><div><h1 className="page-title">工作台</h1><p className="page-subtitle">{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "full" }).format(new Date())} · {user.globalRole === "FINANCE" ? "全公司只读" : "当前授权项目范围"}</p></div>
      <div className="page-actions">{hasPermission(user,"revenue.view") && <Link className="btn btn--outline" href="/business">今日营业额 / 项目经营</Link>}{canSubmit ? <Link className="btn btn--primary" href="/upload?from=dashboard"><Plus size={18} />新建单据</Link> : <Link className="btn btn--primary" href={hasPermission(user,"analytics.view") ? "/analytics" : "/documents"}>{hasPermission(user,"analytics.view") ? "价格分析" : "查看单据"}</Link>}</div></div>
    <section className="work-stats" aria-label="工作概览">
      {[{ label: "草稿", count: counters.draft, icon: FileText, href: "/documents?status=DRAFT" }, { label: "待审核", count: counters.pendingReview, icon: Clock3, href: canReview ? "/reviews" : "/documents?status=PENDING_REVIEW" }, { label: "退回补充", count: counters.needsRevision, icon: RotateCcw, href: "/documents?status=NEEDS_REVISION" }].map(item => <Link className="work-stat card" href={item.href} key={item.label}><item.icon size={24} /><div><span>{item.label}</span><strong>{item.count}</strong></div><ArrowRight size={16} /></Link>)}
      <article className="work-stat card"><Coins size={24} /><div><span>本月已审核采购额</span><strong className="work-spend">{counters.monthSpend === null ? "未授权" : "¥" + formatMoney(counters.monthSpend)}</strong><small className="ledger-meta">按授权项目及单据日期统计</small></div></article>
    </section>
    <section className="work-columns"><article className="card"><div className="card-head"><h2 className="card-title">需要优先处理</h2><Link className="link-button" href="/documents">查看全部</Link></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>供应商</th><th>项目</th><th>单据状态</th><th>金额</th><th>主要问题</th><th>操作</th></tr></thead><tbody>{rows(data.priority || [])}</tbody></table>{!data.priority?.length && <div className="empty"><p>当前没有待处理单据</p></div>}</div></article>
      <article className="card"><div className="card-head"><h2 className="card-title">异常摘要</h2></div><div className="card-body work-risks">
        <div className="notice notice--red"><AlertTriangle size={22} /><div><strong>严重异常 {counters.openErrors} 项</strong><p>合同超价、金额不符等严重问题会限制普通审核通过。</p></div></div>
        <div className="notice"><Clock3 size={22} /><div><strong>识别与价格提醒 {counters.openWarnings} 项</strong><p>低置信度和同供应商单号重复只提醒，请对照原单核对。</p></div></div>
        <Link className="link-button" href={canReview ? "/reviews" : "/documents"}>查看相关单据 <ArrowRight size={15} /></Link>
      </div></article></section>
    <section className="card"><div className="card-head"><h2 className="card-title">最近单据</h2><Link className="link-button" href="/documents">全部单据</Link></div><div className="table-wrap"><table className="data-table"><thead><tr><th>供应商</th><th>项目</th><th>归档日期</th><th>单据状态</th><th>金额</th><th>操作</th></tr></thead><tbody>{rows(data.recent, true)}</tbody></table>{!data.recent.length && <div className="empty"><p>暂无单据，从新建单据开始</p></div>}</div></section>
    <details className="card work-secondary"><summary>采购趋势与项目金额</summary><div className="card-body work-columns"><div><h3>近6个月已通过采购额</h3>{data.trend.map(row => <div className="ledger-pair" key={row.month}><span>{row.month}</span><span className="money">¥{formatMoney(row.amount)}</span></div>)}</div><div><h3>各项目已通过累计金额</h3>{data.projectSpend.map(row => <div className="ledger-pair" key={row.name}><span>{row.name}</span><span className="money">¥{formatMoney(row.amount)}</span></div>)}</div></div></details>
  </div>;
}
