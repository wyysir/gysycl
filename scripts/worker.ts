import { UnrecoverableError, Worker } from "bullmq";
import { env } from "../src/lib/config";
import { getReadyDb } from "../src/lib/bootstrap";
import { processDocumentOcr } from "../src/server/documents";
import { ApiError } from "../src/server/errors";
import { flushLogs, logEvent, recordError, setLogService, withLogContext } from "../src/server/observability/logger";

setLogService("worker");

if (!env.REDIS_URL) {
  logEvent("error", "worker.config_error", { message: "未配置 REDIS_URL" });
  await flushLogs();
  process.exit(1);
}

try { await getReadyDb(); }
catch (error) { recordError("worker.start_failed", error); await flushLogs(); process.exit(1); }
const worker = new Worker(
  "ocr",
  async (job) => withLogContext({ requestId: job.data.traceRequestId, jobId: job.id, documentId: job.data.documentId }, async () => {
    const started = performance.now();
    logEvent("info", "ocr.started", { attempt: job.attemptsMade + 1 });
    const documentId = String(job.data.documentId || "");
    if (!documentId) throw new Error("OCR 任务缺少 documentId");
    try {
      const result = await processDocumentOcr(documentId, job.data.expectedVersion);
      logEvent("info", "ocr.completed", { duration_ms: Math.round(performance.now() - started) });
      return result;
    } catch (error) {
      recordError("ocr.failed", error, { duration_ms: Math.round(performance.now() - started) });
      // Invalid inputs require correction before an explicit retry. New jobs
      // have one attempt so transport failures do not silently repeat billing.
      if (error instanceof ApiError && [400, 404, 409, 422].includes(error.status)) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }),
  {
    connection: { url: env.REDIS_URL },
    concurrency: 5,
  },
);

logEvent("info", "worker.started", { concurrency: 5 });
worker.on("error", error => recordError("worker.error", error));

async function shutdown() {
  await worker.close();
  logEvent("info", "worker.stopped");
  await flushLogs();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
async function fatal(error: unknown) {
  recordError("worker.fatal", error);
  await flushLogs();
  process.exit(1);
}
process.on("uncaughtException", error => void fatal(error));
process.on("unhandledRejection", error => void fatal(error));
