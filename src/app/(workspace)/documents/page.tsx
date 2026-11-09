"use client";

import { DocumentImage } from "@/components/DocumentImage";

import { hasPermission } from "@/lib/permissions";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, FileSearch, Plus, SlidersHorizontal } from "lucide-react";
import { usePageMemory, useScrollMemory } from "@/lib/client/page-memory";
import { api } from "@/lib/client/api";
import type { Bootstrap, DocumentListItem } from "@/lib/client/types";
import {
  ErrorState,
  PageLoading,
  StatusPill,
  formatDate,
  formatMoney,
} from "@/components/ui";

const statuses = [
  ["", "全部状态"],
  ["DRAFT", "草稿"],
  ["PENDING_REVIEW", "待主管审核"],
  ["NEEDS_REVISION", "退回补充"],
  ["APPROVED", "已通过"],
  ["PROCESSING", "识别中"],
];

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [filters, setFilters] = usePageMemory("documents-filters", () => ({
    q: "",
    status: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("status") || "",
    from: "",
    to: "",
    projectId: "",
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(query = filters) {
    setLoading(true);
    setError("");
    try {
      const [bootstrapData, documentData] = await Promise.all([
        bootstrap
          ? Promise.resolve(bootstrap)
          : api.get<Bootstrap>("/api/bootstrap?scope=context"),
        api.get<{ documents: DocumentListItem[] }>(
          `/api/documents?${new URLSearchParams(query).toString()}`,
        ),
      ]);
      setBootstrap(bootstrapData);
      setDocuments(documentData.documents);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("status");
    if (status !== null) { const query = { ...filters, status }; setFilters(query); load(query); }
    else load();
    // Filters are applied explicitly through the search button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useScrollMemory("documents", !loading && !!bootstrap);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading && !bootstrap) return <PageLoading label="正在读取单据…" />;

  const exportQuery = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    projectId: filters.projectId,
    status: filters.status,
  }).toString();
  const canSubmit = bootstrap && hasPermission(bootstrap.user,"document.create");
  const canExport = bootstrap && hasPermission(bootstrap.user,"document.export");

  return (
    <div className="page documents-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">单据中心</h1>
          <p className="page-subtitle">查找、校正并追踪每一张采购送货单。</p>
        </div>
        <div className="page-actions">
          {canExport ? <a className="btn btn--outline" href={`/api/export/documents?${exportQuery}`}>
            <Download size={15} /> 导出 Excel
          </a> : null}
          {canSubmit ? (
            <Link className="btn btn--primary" href="/upload?from=documents">
              <Plus size={15} /> 新建单据
            </Link>
          ) : null}
        </div>
      </div>
      <section className="card">
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            load();
          }}
        >
            <input
              className="input search-input"
              aria-label="搜索原材料、供应商、项目点或单号"
              placeholder="原材料、供应商、项目点或单号"
              value={filters.q}
              onChange={(event) =>
                setFilters((current) => ({ ...current, q: event.target.value }))
              }
            />
          <select
            className="select"
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
          >
            {statuses.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
          <select
            className="select"
            value={filters.projectId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, projectId: event.target.value }))
            }
          >
            <option value="">全部项目点</option>
            {bootstrap?.projects.map((project) => (
              <option value={project.id} key={project.id}>{project.name}</option>
            ))}
          </select>
          <input
            className="input"
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
            title="开始日期"
          />
          <input
            className="input"
            type="date"
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({ ...current, to: event.target.value }))
            }
            title="结束日期"
          />
          <button className="btn btn--primary btn--small" type="submit">
            <SlidersHorizontal size={13} /> 查询
          </button>
          <span className="toolbar-spacer" />
          <span className="text-muted" style={{ fontSize: 12 }}>
            共 {documents.length} 张
          </span>
        </form>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>供应商</th>
                <th>项目点</th>
                <th>日期</th>
                <th>明细</th>
                <th>金额</th>
                <th>异常</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>
                    <Link href={`/documents/${document.id}?from=documents`} className="document-preview-link">
                      {document.previewImageUrl && <DocumentImage src={document.previewImageUrl} alt="原单缩略图" thumbnail />}
                      <span className="cell-stack"><strong>{document.supplierName || "供应商待确认"}</strong>{document.previewImageUrl && <small>查看原图与明细</small>}</span>
                    </Link>
                  </td>
                  <td data-label="项目点">{document.projectName}</td>
                  <td data-label="日期">{formatDate(document.docDate)}</td>
                  <td data-label="明细">{document.itemCount} 项</td>
                  <td className="money" data-label="金额">¥{formatMoney(document.totalAmount)}</td>
                  <td data-label="异常">
                    {document.errorCount ? (
                      <span className="count-badge count-badge--danger">{document.errorCount}</span>
                    ) : document.warningCount ? (
                      <span className="count-badge">{document.warningCount}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td data-label="状态"><StatusPill status={document.status} /></td>
                  <td>
                    <Link className="icon-button" aria-label={`查看${document.supplierName || "单据"}明细`} href={`/documents/${document.id}?from=documents`}>
                      <FileSearch size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
              {!documents.length ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      <div className="empty-icon"><FileSearch size={18} /></div>
                      <p>没有符合条件的单据</p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
