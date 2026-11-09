import { UnrecoverableError, Worker } from "bullmq";
import { env } from "../src/lib/config";
import { getReadyDb } from "../src/lib/bootstrap";
import { processDocumentOcr } from "../src/server/documents";
import { ApiError } from "../src/server/errors";

if (!env.REDIS_URL) {
  console.error("未配置 REDIS_URL，OCR Worker 无法启动。本地开发会自动在 Web 进程内处理任务。");
  process.exit(1);
}

await getReadyDb();
const worker = new Worker(
  "ocr",
  async (job) => {
    const documentId = String(job.data.documentId || "");
    if (!documentId) throw new Error("OCR 任务缺少 documentId");
    try {
      return await processDocumentOcr(documentId, job.data.expectedVersion);
    } catch (error) {
      // Invalid inputs require correction before an explicit retry. New jobs
      // have one attempt so transport failures do not silently repeat billing.
      if (error instanceof ApiError && [400, 404, 409, 422].includes(error.status)) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 5,
  },
);

worker.on("completed", (job) => {
  console.log(`OCR 完成：${job.data.documentId}`);
});
worker.on("failed", (job, error) => {
  console.error(`OCR 失败：${job?.data?.documentId}`, error);
});

async function shutdown() {
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
