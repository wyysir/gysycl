"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileSearch,
  RotateCcw,
} from "lucide-react";
import { hasPermission } from "@/lib/permissions";
import type { User } from "@/lib/client/types";
import { api } from "@/lib/client/api";
import { usePageMemory, useScrollMemory } from "@/lib/client/page-memory";
import type {
  DocumentDetail,
  DocumentDto,
  DocumentListItem,
} from "@/lib/client/types";
import {
  CheckList,
  ErrorState,
  PageLoading,
  StatusPill,
  formatDate,
  formatMoney,
} from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { DocumentImage } from "@/components/DocumentImage";

type ReviewData = {
  user: User;
  confidenceThreshold: number;
  pending: DocumentListItem[];
  returned: DocumentListItem[];
};

function ReviewsContent() {
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [reviews, setReviews] = useState<ReviewData | null>(null);
  const [tab, setTab] = usePageMemory<"pending" | "returned">("reviews-tab", "pending");
  const [selectedId, setSelectedId] = usePageMemory("reviews-selection", "");
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const detailSequence = useRef(0);

  const loadReviews = useCallback(async () => {
    setError("");
    try {
      const data = await api.get<ReviewData>("/api/reviews");
      setReviews(data);
      const fromQuery = searchParams.get("doc");
      const requested = data[tab].find(row => row.id === fromQuery)?.id;
      const candidate = data[tab][0]?.id || "";
      setSelectedId(current => requested || (data[tab].some(row => row.id === current) ? current : candidate));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [searchParams, tab]);

  const loadDetail = useCallback(async (id: string) => {
    const sequence = ++detailSequence.current;
    setDetail(null);
    if (!id) return;
    try {
      const data = await api.get<DocumentDetail>(`/api/documents/${id}`);
      if (sequence !== detailSequence.current) return;
      setDetail(data);
      setNote(data.document.reviewNote || data.document.notes || "");
    } catch (caught) {
      if (sequence === detailSequence.current) showToast(caught instanceof Error ? caught.message : "读取失败", "error");
    }
  }, [showToast]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  useEffect(() => {
    loadDetail(selectedId);
    return () => { detailSequence.current++; };
  }, [loadDetail, selectedId]);

  async function review(action: "approve" | "return") {
    if (!detail || detail.document.id !== selectedId) return;
    const document = detail.document;
    const errors = document.checks.filter(
      (check) => check.status === "OPEN" && check.severity === "ERROR",
    );
    let override = false;
    if (action === "approve" && errors.length) {
      override = window.confirm(
        `该单据仍有 ${errors.length} 项严重异常。\n确认填写原因并强制通过？此操作将完整留痕。`,
      );
      if (!override) return;
    }
    if (action === "return" && !note.trim()) {
      showToast("退回补充必须填写原因", "error");
      return;
    }
    if (override && !note.trim()) {
      showToast("强制通过必须在复核说明中填写原因", "error");
      return;
    }
    setActing(true);
    try {
      await api.post(`/api/documents/${document.id}/review`, {
        action,
        note,
        override,
      });
      showToast(
        action === "approve"
          ? override
            ? "已强制通过并记录原因"
            : "审核通过"
          : "已退回项目点补充",
      );
      setDetail(null);
      setSelectedId("");
      await loadReviews();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "审核失败", "error");
      await loadDetail(document.id);
    } finally {
      setActing(false);
    }
  }

  useScrollMemory("reviews", !loading && !!reviews);
  if (error) return <ErrorState message={error} onRetry={loadReviews} />;
  if (loading || !reviews) return <PageLoading label="正在载入待办…" />;

  const list = tab === "pending" ? reviews.pending : reviews.returned;
  const document = detail?.document.id === selectedId ? detail.document : undefined;
  const errors =
    document?.checks.filter(
      (check) => check.status === "OPEN" && check.severity === "ERROR",
    ) || [];
  const warnings =
    document?.checks.filter(
      (check) => check.status === "OPEN" && check.severity === "WARNING",
    ) || [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">审核队列</h1>
          <p className="page-subtitle">
            先看异常，再对照原图；主管可直接修正，所有修改都会留痕。
          </p>
        </div>
        <div className="page-actions">
          <span className="pill pill--pending_review">
            待审核 {reviews.pending.length}
          </span>
          <span className="pill pill--needs_review">
            退回待处理 {reviews.returned.length}
          </span>
        </div>
      </div>
      <div className="review-layout">
        <section className="card review-list">
          <div className="toolbar">
            <div className="segmented">
              <button
                type="button"
                className={tab === "pending" ? "is-active" : ""}
                onClick={() => setTab("pending")}
              >
                待审核
              </button>
              <button
                type="button"
                className={tab === "returned" ? "is-active" : ""}
                onClick={() => setTab("returned")}
              >
                已退回
              </button>
            </div>
            <span className="toolbar-spacer" />
            <span className="text-muted" style={{ fontSize: 12 }}>
              {list.length} 单
            </span>
          </div>
          <div className="review-list-scroll">
            {list.map((item) => (
              <Link
                className={`review-item ${selectedId === item.id ? "is-active" : ""}`}
                href={`/documents/${item.id}?from=reviews`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="review-item-top">
                  <strong>{item.supplierName || "供应商待确认"}</strong>
                  <StatusPill status={item.status} />
                </div>
                <div className="review-item-meta">
                  <span>{item.projectName}</span>
                  <span>{formatDate(item.docDate)}</span>
                  <span className="money">¥{formatMoney(item.totalAmount)}</span>
                </div>
                <div className="review-item-meta">

                  {item.errorCount ? (
                    <span className="count-badge count-badge--danger">
                      {item.errorCount} 异常
                    </span>
                  ) : item.warningCount ? (
                    <span className="count-badge">{item.warningCount} 提醒</span>
                  ) : (
                    <span className="pill pill--approved">检查通过</span>
                  )}
                </div>
              </Link>
            ))}
            {!list.length ? (
              <div className="empty">
                <div className="empty-icon"><CheckCircle2 size={18} /></div>
                <p>{tab === "pending" ? "没有待审核单据" : "没有退回单据"}</p>
              </div>
            ) : null}
          </div>
        </section>
        <section className="card review-preview">
          {!document ? (
            <div className="empty">
              <div className="empty-icon"><FileSearch size={18} /></div>
              <p>从左侧选择一张单据开始复核</p>
            </div>
          ) : (
            <>
              <div className="review-preview-head">
                <div>
                  <h3>{document.supplierName || "供应商待确认"}</h3>
                  <p>
                    {document.projectName} ·{" "}
                    {formatDate(document.docDate)}
                  </p>
                </div>
                <StatusPill status={document.status} />
              </div>
              <div className="review-summary-grid">
                <div className="review-summary-cell">
                  <span>单据总价</span>
                  <strong>¥{formatMoney(document.totalAmount)}</strong>
                </div>
                <div className="review-summary-cell">
                  <span>明细行数</span>
                  <strong>{document.items.length}</strong>
                </div>
                <div className="review-summary-cell">
                  <span>识别置信度</span>
                  <strong>
                    {Math.round(
                      (document.items.reduce(
                        (sum, item) => sum + item.confidence,
                        0,
                      ) /
                        Math.max(1, document.items.length)) *
                        100,
                    )}
                    %
                  </strong>
                </div>
                <div className="review-summary-cell">
                  <span>异常 / 提醒</span>
                  <strong className={errors.length ? "text-danger" : ""}>
                    {errors.length} / {warnings.length}
                  </strong>
                </div>
              </div>
              <div className="review-image-strip">
                {document.pages.slice(0, 3).map((page) => (
                  <DocumentImage key={page.id} src={page.url} alt={page.fileName} />
                ))}
                <Link className="btn btn--outline btn--small" href={`/documents/${document.id}`}>
                  对照原图校正
                </Link>
              </div>
              <div className="table-wrap review-items-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>品名</th><th>规格 / 单位</th><th>数量</th><th>单价</th><th>行金额</th><th>置信</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.items.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong></td>
                        <td>{item.spec || "—"} / {item.unit || "—"}</td>
                        <td>{item.quantity}</td>
                        <td className="money">¥{formatMoney(item.unitPrice)}</td>
                        <td className="money">¥{formatMoney(item.amount)}</td>
                        <td className={item.confidence < reviews.confidenceThreshold ? "text-warning" : ""}>
                          {Math.round(item.confidence * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="review-checks">{errors.length>0&&<div className="notice notice--red"><strong>普通通过暂不可用</strong><p>{errors.map(c=>c.title).join("；")}。警告提醒不影响普通通过。</p></div>}
                <CheckList checks={document.checks} />
              </div>
              {document.status === "PENDING_REVIEW" ? (
                <>
                  <div className="field">
                    <label htmlFor="reviewNote">审核说明 / 强制通过原因</label>
                    <textarea
                      className="textarea review-note"
                      id="reviewNote"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="普通通过可不填；退回、强制通过时必须说明原因。"
                    />
                  </div>
                  <div className="review-actions">
                    <Link
                      className="btn btn--outline"
                      href={`/documents/${document.id}?from=reviews`}
                    >
                      <FileSearch size={14} /> 核对并审核
                    </Link>
                    <span style={{ flex: 1 }} />
                    <button
                      className="btn btn--outline"
                      type="button"
                      disabled={acting || !hasPermission(reviews.user,"document.return",document.projectId)}
                      onClick={() => review("return")}
                    >
                      <RotateCcw size={14} /> 退回补充
                    </button>
                    <button
                      className="btn btn--primary"
                      type="button"
                      disabled={acting || errors.length > 0 || !hasPermission(reviews.user,"document.approve",document.projectId)}
                      onClick={() => review("approve")}
                    >
                      <Check size={14} /> 普通通过
                    </button>
                    {errors.length > 0 && hasPermission(reviews.user,"document.approve",document.projectId) && hasPermission(reviews.user,"document.override",document.projectId) && <button className="btn btn--danger" disabled={acting} onClick={() => review("approve")}><AlertTriangle size={14} />填写原因并强制通过</button>}
                  </div>
                </>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense fallback={<PageLoading label="正在载入复核中心…" />}>
      <ReviewsContent />
    </Suspense>
  );
}
