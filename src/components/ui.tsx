"use client";

import { AlertTriangle, CheckCircle2, Info, LoaderCircle } from "lucide-react";
import type { CheckResult } from "@/lib/client/types";

export function formatMoney(value: number | string | null | undefined, authorized = true) {
  if (!authorized) return "未授权";
  if (value == null) return "—";
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCompactMoney(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusLabel(status: string) {
  return (
    {
      PROCESSING: "识别中",
      DRAFT: "草稿",
      PENDING_REVIEW: "待主管审核",
      APPROVED: "已通过",
      NEEDS_REVISION: "退回补充",
    }[status] || status
  );
}

export function StatusPill({ status }: { status: string }) {
  const className =
    status === "APPROVED"
      ? "approved"
      : status === "PENDING_REVIEW"
        ? "pending_review"
        : status === "NEEDS_REVISION"
          ? "needs_review"
          : status === "PROCESSING"
            ? "info"
            : "draft";
  return <span className={`pill pill--${className}`}>{statusLabel(status)}</span>;
}

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <span
      className={`pill pill--${
        severity === "ERROR"
          ? "error"
          : severity === "WARNING"
            ? "warning"
            : "info"
      }`}
    >
      {severity === "ERROR"
        ? "必须处理"
        : severity === "WARNING"
          ? "建议确认"
          : "提示"}
    </span>
  );
}

export function CheckList({
  checks,
  compact = false,
  onLocate,
}: {
  checks: CheckResult[];
  compact?: boolean;
  onLocate?: (itemId: string) => void;
}) {
  const open = checks.filter((check) => check.status === "OPEN");
  if (!open.length) {
    return (
      <div className="checks-empty">
        <CheckCircle2 size={17} />
        所有自动比对项均已通过
      </div>
    );
  }
  return (
    <div className="checks-list">
      {open.map((check) => (
        <div
          key={check.id}
          className={`check-item check-item--${check.severity.toLowerCase()}`}
          role={onLocate && check.itemId ? "button" : undefined}
          tabIndex={onLocate && check.itemId ? 0 : undefined}
          onClick={() => { if (check.itemId) onLocate?.(check.itemId); }}
          onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && check.itemId && onLocate) { event.preventDefault(); onLocate(check.itemId); } }}
        >
          <span className="check-dot" />
          <div className="check-copy">
            <strong>{check.title}</strong>
            {!compact ? <p>{check.detail}</p> : null}
            <span className="check-dimension">
              {check.dimension} ·{" "}
              {check.severity === "ERROR" ? (
                <AlertTriangle size={10} style={{ display: "inline" }} />
              ) : check.severity === "WARNING" ? (
                <AlertTriangle size={10} style={{ display: "inline" }} />
              ) : (
                <Info size={10} style={{ display: "inline" }} />
              )}{" "}
              {check.severity === "ERROR"
                ? "必须处理"
                : check.severity === "WARNING"
                  ? "建议确认"
                  : "提示"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageLoading({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="page">
      <div className="empty" style={{ minHeight: "60vh" }}>
        <LoaderCircle className="spin" size={28} />
        <p>{label}</p>
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="page">
      <div className="empty" style={{ minHeight: "55vh" }}>
        <div className="empty-icon">
          <AlertTriangle size={20} />
        </div>
        <p>{message}</p>
        {onRetry ? (
          <button className="btn btn--primary btn--small" onClick={onRetry}>
            重新加载
          </button>
        ) : null}
      </div>
    </div>
  );
}
