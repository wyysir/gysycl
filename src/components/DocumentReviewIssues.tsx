"use client";
import { reviewIssues } from "@/lib/client/item-editing";
import type { CheckResult, DocumentItem } from "@/lib/client/types";

export function DocumentReviewIssues({ items, checks, threshold, activeId, onLocate, onEvidence }: {
  items: DocumentItem[]; checks: CheckResult[]; threshold: number; activeId?: string;
  onLocate: (id: string) => void; onEvidence: () => void;
}) {
  const issues = reviewIssues(items, checks, threshold);
  const documentIssues = checks.filter(check => !check.itemId && check.status === "OPEN" && check.severity !== "INFO");
  return <div className="review-issues" aria-label="待处理问题">
    <span className="review-issue-count">{items.length} 行 · {issues.length + documentIssues.length} 项提醒</span>
    <div className="review-issue-scroll">{issues.map(issue => <button key={issue.id} type="button" className={`review-issue ${issue.error ? "is-error" : ""} ${activeId === issue.id ? "is-selected" : ""}`} onClick={() => onLocate(issue.id)}>
      第{issue.line}行 · {issue.name} · {issue.label}
    </button>)}{documentIssues.map(issue => <button key={issue.id} className={`review-issue ${issue.severity === "ERROR" ? "is-error" : ""}`} onClick={onEvidence}>{issue.title}</button>)}
    {!issues.length && !documentIssues.length && <span className="text-muted">请对照原图核对明细</span>}</div>
  </div>;
}
