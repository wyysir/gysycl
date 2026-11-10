import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { FileLogSink } from "./file-sink";
import { cleanText, errorDetails, privateValues, redact } from "./redaction";

export type LogContext = { requestId?: string; jobId?: string; documentId?: string; userId?: string; requestBody?: unknown; secrets?: string[] };
type State = { storage: AsyncLocalStorage<LogContext>; service: string; sink?: FileLogSink };
const scope = globalThis as typeof globalThis & { __deliveryObservability?: State };
const state = scope.__deliveryObservability ||= { storage: new AsyncLocalStorage<LogContext>(), service: "web" };
const runtimeSecrets = Object.entries(process.env).filter(([key, value]) => /SECRET|PASSWORD|TOKEN|ACCESS_KEY|API_KEY|DATABASE_URL|REDIS_URL/.test(key) && value && value.length >= 8).map(([, value]) => value!);

export function logContext() { return state.storage.getStore(); }
export function withLogContext<T>(context: LogContext, callback: () => T): T { return state.storage.run(context, callback); }
export function setLogService(service: "web" | "worker") { state.service = service; }
export function loggingEnabled() { return process.env.LOG_ENABLED !== "false" && (process.env.NODE_ENV !== "test" || process.env.LOG_ENABLED === "true"); }
function bounded(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]); return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
function sink() {
  return state.sink ||= new FileLogSink({
    directory: process.env.APP_LOG_DIR || path.resolve(".data/logs"), service: state.service,
    maxBytes: bounded("LOG_MAX_FILE_MB", 20, 1, 100) * 1024 * 1024,
    maxFiles: bounded("LOG_MAX_FILES", 30, 2, 100), retentionDays: bounded("LOG_RETENTION_DAYS", 14, 1, 90),
  });
}
export function logEvent(level: "info" | "warn" | "error", event: string, details: Record<string, unknown> = {}) {
  if (!loggingEnabled()) return;
  try {
    const context = logContext(), secrets = [...runtimeSecrets, ...(context?.secrets || [])];
    const common = { timestamp: new Date().toISOString(), level, event, service: state.service, release: process.env.RELEASE_ID || "unknown", request_id: context?.requestId, job_id: context?.jobId, document_id: context?.documentId, user_id: context?.userId };
    let line = JSON.stringify({ ...common, ...redact(details, secrets) as object });
    if (Buffer.byteLength(line) > 24_000) line = JSON.stringify({ ...common, truncated: true, excerpt: line.slice(0, 6000) });
    sink().write(line + "\n");
  } catch {
    process.stderr.write('{"event":"logging.serialization_failed"}\n');
  }
}
export function captureRequestData(data: unknown) {
  const context = logContext(); if (!context) return;
  context.secrets = [...(context.secrets || []), ...privateValues(data)].slice(0, 64);
  context.requestBody = redact(data, [...runtimeSecrets, ...context.secrets], 0, true);
}
export function captureFormData(form: FormData) {
  const fields: Record<string, unknown> = Object.create(null);
  for (const [key, value] of form) {
    const entry = typeof value === "string" ? value : { name: value.name, size: value.size, type: value.type };
    fields[key] = key in fields ? [fields[key], entry] : entry;
  }
  captureRequestData(fields);
}
export function recordError(event: string, error: unknown, details: Record<string, unknown> = {}, database = false) {
  const status = Number(details.status);
  logEvent(status >= 400 && status < 500 ? "warn" : "error", event, { ...details, error: errorDetails(error, [...runtimeSecrets, ...(logContext()?.secrets || [])], database) });
}
export function safeLogText(text: string) { return cleanText(text, [...runtimeSecrets, ...(logContext()?.secrets || [])]); }
export function logStatus() { return { enabled: loggingEnabled(), dropped: state.sink?.dropped || 0, writeFailures: state.sink?.failures || 0, lastErrorCode: state.sink?.lastErrorCode || "" }; }
export async function flushLogs() { await state.sink?.flush(); }
