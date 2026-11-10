import { createServer } from "node:http";
import next from "next";
import { observeHttpRequest } from "../src/server/observability/http";
import { flushLogs, logEvent, recordError, setLogService } from "../src/server/observability/logger";

setLogService("web");
const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT || 3000);
const hostname = process.env.BIND_HOST || "0.0.0.0";
const server = createServer((request, response) => {
  void observeHttpRequest(request, response, () => handle(request, response));
});
const app = next({ dev, port, hostname, httpServer: server });
const handle = app.getRequestHandler();
server.on("error", error => { recordError("process.server_error", error); void stop(1); });
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => { server.closeAllConnections(); void flushLogs().finally(() => process.exit(code)); }, 10_000);
  timeout.unref();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await app.close();
  logEvent("info", "process.stopped", { code });
  await flushLogs();
  process.exit(code);
}
process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));
process.on("uncaughtException", error => { recordError("process.uncaught_exception", error); void stop(1); });
process.on("unhandledRejection", error => { recordError("process.unhandled_rejection", error); void stop(1); });
try {
  await app.prepare();
  server.listen(port, hostname, () => logEvent("info", "process.started", { port, dev }));
} catch (error) {
  recordError("process.start_failed", error);
  await stop(1);
}
