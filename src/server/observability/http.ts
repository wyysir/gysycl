import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import { captureRequestData, logContext, logEvent, recordError, safeLogText, withLogContext, type LogContext } from "./logger";
import { privateValues, redact } from "./redaction";

const bodyLimit = 16 * 1024;
export function observeHttpRequest(request: IncomingMessage, response: ServerResponse, handler: () => Promise<unknown> | unknown) {
  const supplied = request.headers["x-request-id"];
  const requestId = typeof supplied === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(supplied) ? supplied : randomUUID();
  const context: LogContext = { requestId, secrets: [] };
  return withLogContext(context, async () => {
    const started = performance.now();
    response.setHeader("X-Request-ID", requestId);
    let parsed: URL;
    try { parsed = new URL(request.url || "/", "http://localhost"); } catch { parsed = new URL("http://localhost/invalid-url"); }
    const query: Record<string, unknown> = Object.create(null);
    for (const [key, value] of parsed.searchParams) query[key] = key in query ? [query[key], value] : value;
    context.secrets = privateValues(query);
    const metadata = { method: request.method, path: safeLogText(parsed.pathname), query: redact(query, [], 0, true), content_type: request.headers["content-type"], content_length: request.headers["content-length"], user_agent: request.headers["user-agent"], client_ip: request.headers["x-real-ip"] || request.socket.remoteAddress };
    const chunks: Buffer[] = [];
    let received = 0, captured = 0, completed = false;
    const push = request.push;
    // Inspect the bytes without adding a data listener or changing stream flow.
    request.push = function (chunk: unknown, encoding?: BufferEncoding): boolean {
      if (chunk && (Buffer.isBuffer(chunk) || typeof chunk === "string")) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        received += buffer.length;
        const remaining = bodyLimit - captured;
        if (remaining > 0) { const copy = Buffer.from(buffer.subarray(0, remaining)); chunks.push(copy); captured += copy.length; }
      }
      return push.call(this, chunk, encoding);
    };
    function finish(aborted: boolean) {
      if (completed) return;
      completed = true;
      withLogContext(context, () => {
        const contentType = String(request.headers["content-type"] || "");
        if (context.requestBody === undefined && received) {
          if (received <= bodyLimit && !request.headers["content-encoding"] && contentType.includes("application/json")) {
            try { captureRequestData(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { context.requestBody = { unparsed: true, reason: "invalid JSON or interrupted body" }; }
          } else context.requestBody = { omitted: contentType.includes("multipart") ? "file contents" : "binary, encoded or oversized body", received_bytes: received, capture_limit: bodyLimit };
        }
        const duration = Math.round((performance.now() - started) * 100) / 100;
        const failed = aborted || response.statusCode >= 500;
        logEvent(failed ? "error" : response.statusCode >= 400 ? "warn" : "info", "http.completed", {
          ...metadata, status: response.statusCode, duration_ms: duration, aborted,
          request_bytes: received, response_content_length: response.getHeader("content-length"),
          request_body: context.requestBody ?? { read: false }, slow: duration >= Number(process.env.LOG_SLOW_HTTP_MS || 2000),
        });
      });
    }
    logEvent("info", "http.started", metadata);
    response.once("finish", () => finish(false));
    response.once("close", () => finish(!response.writableFinished));
    request.once("error", error => recordError("http.request_error", error, metadata));
    response.once("error", error => recordError("http.response_error", error, metadata));
    try { return await handler(); }
    catch (error) {
      recordError("http.unhandled_error", error, metadata);
      if (response.headersSent) { response.destroy(); return; }
      response.statusCode = 500; response.setHeader("Content-Type", "application/json");
      if (!response.writableEnded) response.end(JSON.stringify({ error: "服务器内部错误", requestId: logContext()?.requestId }));
    }
  });
}
