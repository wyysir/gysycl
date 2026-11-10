import { createServer, request as nodeRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FileLogSink } from "@/server/observability/file-sink";
import { errorDetails, privateValues, redact, safeSql } from "@/server/observability/redaction";
import { captureFormData, captureRequestData, flushLogs, logContext, logEvent, withLogContext } from "@/server/observability/logger";
import { observeHttpRequest } from "@/server/observability/http";
import { observeDatabase } from "@/server/observability/database";
import type { SqlDriverAdapterFactory } from "@prisma/driver-adapter-utils";

let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "delivery-logs-")); vi.stubEnv("APP_LOG_DIR", directory); vi.stubEnv("LOG_ENABLED", "true"); });
afterAll(async () => { await flushLogs(); vi.unstubAllEnvs(); });
async function rows() {
  await flushLogs();
  return (await Promise.all((await readdir(directory)).map(name => readFile(path.join(directory, name), "utf8")))).join("").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

describe("日志脱敏与语句保留", () => {
  it("嵌套密码、授权码、Cookie、个人联系方式脱敏，错误码保留", () => {
    const value = { nested: [{ password: "secret-demo", code: "wechat-code", email: "a@example.test" }], authorization: "Bearer token-demo" };
    expect(JSON.stringify(redact(value, privateValues(value), 0, true))).not.toMatch(/secret-demo|wechat-code|a@example/);
    expect(redact({ code: "23505" })).toEqual({ code: "23505" });
  });
  it("SQL保留字段与占位符，去掉内嵌值、注释、美元字符串和未闭合字面量", () => {
    const sql = `SELECT "passwordHash", $1, 'abc--private', E'quote\\\'private', $$dollar-private$$, $tag$tag-private$tag$, 123 /*comment-private*/ FROM "User" WHERE "id"=$2`;
    const output = safeSql(sql);
    expect(output).toContain('"passwordHash", $1');
    expect(output).toContain('"id"=$2');
    expect(output).not.toMatch(/private|123/);
    expect(safeSql("SELECT 'unclosed-private")).not.toContain("private");
  });
  it("数据库错误保留SQLSTATE和原因，隐藏驱动原始消息与参数", () => {
    const error = Object.assign(new Error("INSERT password plain-private"), { name: "PrismaClientKnownRequestError", code: "P2002", cause: { originalCode: "23505", originalMessage: "value private", message: "plain-private" } });
    const details = errorDetails(error);
    expect(details).toMatchObject({ code: "P2002", message: "唯一约束冲突", cause: { code: "23505", message: "唯一约束冲突" } });
    expect(JSON.stringify(details)).not.toContain("plain-private");
  });
});

describe("HTTP 请求观察", () => {
  it("不消耗请求流，记录请求/响应、异常、并发编号与耗时", async () => {
    const server = createServer((request, response) => { void observeHttpRequest(request, response, async () => {
      if (request.url?.startsWith("/throw")) throw new Error("controlled failure");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      if (request.url === "/parsed") captureRequestData(JSON.parse(body));
      if (request.url === "/form") { const form = new FormData(); form.set("label", "材料"); form.set("file", new File([body], "材料.xlsx")); captureFormData(form); }
      await new Promise(resolve => setTimeout(resolve, request.url === "/slow" ? 30 : 1));
      logEvent("info", "test.inside", { path: request.url });
      response.statusCode = request.url === "/missing" ? 404 : 200;
      response.end(body || "ok");
    }); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const response = await fetch(base + "/parsed", { method: "POST", headers: { "content-type": "application/json", "x-request-id": "test-parsed-123" }, body: JSON.stringify({ label: "原材料", password: "must-not-appear", code: "oauth-private" }) });
      expect(response.headers.get("x-request-id")).toBe("test-parsed-123");
      expect((await response.json()).label).toBe("原材料");
      await fetch(base + "/fallback?token=query-private&page=2", { method: "POST", headers: { "content-type": "application/json" }, body: '{"quantity":12,"password":"fallback-private"}' });
      await fetch(base + "/large", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ field: "large-private".repeat(4000) }) });
      await fetch(base + "/invalid", { method: "POST", headers: { "content-type": "application/json" }, body: '{broken-private' });
      await fetch(base + "/form", { method: "POST", body: "binary-private" });
      await Promise.all(["slow", "fast", "missing", "throw"].map(name => fetch(base + "/" + name, { headers: { "x-request-id": "test-" + name + "-123" } })));
      const logs = await rows(), text = JSON.stringify(logs);
      expect(text).not.toMatch(/must-not-appear|oauth-private|fallback-private|query-private|broken-private|binary-private|large-private/);
      const completed = logs.filter(row => row.event === "http.completed");
      expect(completed).toHaveLength(9);
      expect(completed.find(row => row.path === "/parsed")).toMatchObject({ request_id: "test-parsed-123", status: 200, request_body: { label: "原材料", password: "[REDACTED]" }, aborted: false });
      expect(completed.find(row => row.path === "/large").request_body.omitted).toBeTruthy();
      expect(completed.find(row => row.path === "/form").request_body.file).toMatchObject({ name: "材料.xlsx", size: 14 });
      expect(completed.find(row => row.path === "/missing").level).toBe("warn");
      expect(completed.find(row => row.path === "/throw").status).toBe(500);
      for (const name of ["slow", "fast"]) expect(logs.find(row => row.event === "test.inside" && row.path === "/" + name).request_id).toBe("test-" + name + "-123");
      expect(completed.every(row => typeof row.duration_ms === "number")).toBe(true);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("客户端中断仍记录，且无重复完成日志", async () => {
    const server = createServer((req, res) => { void observeHttpRequest(req, res, () => new Promise<void>(resolve => { res.write("part"); res.once("close", resolve); })); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      await new Promise<void>(resolve => { const req = nodeRequest({ port: (server.address() as { port: number }).port, host: "127.0.0.1", path: "/abort", headers: { "x-request-id": "test-aborted-123" } }, response => { response.once("data", () => { response.destroy(); resolve(); }); }); req.end(); });
      await new Promise(resolve => setTimeout(resolve, 30));
      expect((await rows()).filter(row => row.event === "http.completed" && row.request_id === "test-aborted-123")).toMatchObject([{ aborted: true, level: "error" }]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe("数据库驱动观察与请求关联", () => {
  it("普通查询、事务、失败均记录，返回值和原异常保持一致", async () => {
    const failure = Object.assign(new Error("parameter-private"), { code: "23505" });
    const transaction = { queryRaw: async () => ({ rows: [[1]], columnNames: ["id"], columnTypes: [0] }), executeRaw: async () => { throw failure; }, commit: async () => {}, rollback: async () => {} };
    const adapter = { ...transaction, startTransaction: async () => transaction };
    const factory = observeDatabase({ connect: async () => adapter, provider: "postgres", adapterName: "test" } as unknown as SqlDriverAdapterFactory);
    await Promise.all(["sql-request-A", "sql-request-B"].map(id => withLogContext({ requestId: id }, async () => {
      const connection = await factory.connect();
      const tx = await connection.startTransaction();
      expect(await tx.queryRaw({ sql: "SELECT $1", args: ["parameter-private"], argTypes: [] })).toMatchObject({ rows: [[1]] });
      await expect(tx.executeRaw({ sql: "INSERT INTO example VALUES ($1)", args: ["parameter-private"], argTypes: [] })).rejects.toBe(failure);
      await tx.rollback();
    })));
    const logs = (await rows()).filter(row => row.request_id?.startsWith("sql-request-"));
    expect(JSON.stringify(logs)).not.toContain("parameter-private");
    for (const id of ["sql-request-A", "sql-request-B"]) {
      expect(logs.filter(row => row.request_id === id).map(row => row.operation)).toEqual(["connect", "begin", "queryRaw", "executeRaw", "rollback"]);
      expect(logs.find(row => row.request_id === id && row.event === "db.error")).toMatchObject({ error: { code: "23505", message: "唯一约束冲突" }, parameter_count: 1 });
    }
    expect(logContext()).toBeUndefined();
  });
});

describe("持久文件、轮转与故障降级", () => {
  it("查询命令按编号筛选最近记录，并跳过损坏行", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "delivery-log-reader-"));
    const fixture = [
      { timestamp: "2026-11-11T01:00:00Z", request_id: "query-test", level: "error", event: "db.error" },
      { timestamp: "2026-11-11T02:00:00Z", request_id: "other-test", level: "error", event: "db.error" },
      { timestamp: "2026-11-11T03:00:00Z", request_id: "query-test", level: "error", event: "db.error" },
    ];
    await writeFile(path.join(dir, "web-2026-11-11-12345678-1.jsonl"), fixture.map(row => JSON.stringify(row)).join("\n") + '\n{broken\n');
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/read-logs.ts", "--dir", dir, "--request", "query-test", "--limit", "1"], { cwd: process.cwd() });
    expect(JSON.parse(result.stdout)).toMatchObject({ timestamp: "2026-11-11T03:00:00Z", request_id: "query-test" });
    expect(result.stderr).toContain("1 条不完整记录");
  });
  it("文件数量/大小/保留期限受控，保留无关文件，日志均为有效JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "delivery-rotation-"));
    await writeFile(path.join(dir, "keep.txt"), "keep");
    const old = path.join(dir, "web-2020-01-01-12345678-1.jsonl"); await writeFile(old, "old"); await utimes(old, new Date(0), new Date(0));
    const sink = new FileLogSink({ directory: dir, service: "web", maxBytes: 60, maxFiles: 3, retentionDays: 1 });
    for (let i = 0; i < 15; i++) { sink.write(JSON.stringify({ i, value: "1234567890" }) + "\n"); await sink.flush(); }
    const files = await readdir(dir);
    expect(files).toContain("keep.txt"); expect(files).not.toContain(path.basename(old));
    expect(files.filter(name => name.endsWith("jsonl")).length).toBeLessThanOrEqual(3);
    for (const file of files.filter(name => name.endsWith("jsonl"))) for (const line of (await readFile(path.join(dir, file), "utf8")).trim().split("\n")) expect(() => JSON.parse(line)).not.toThrow();
  });
  it("写盘失败降级到stderr，队列溢出有明确计数且不抛业务异常", async () => {
    const file = path.join(directory, "blocked"); await writeFile(file, "file");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const sink = new FileLogSink({ directory: file, service: "web", maxBytes: 100, maxFiles: 2, retentionDays: 1, maxQueue: 2 });
      for (let i = 0; i < 10; i++) sink.write('{"test":true}\n');
      await sink.flush();
      expect(sink.failures).toBeGreaterThan(0); expect(sink.dropped).toBeGreaterThan(0);
      expect(stderr.mock.calls.map(call => call[0]).join("")).toContain("logging.write_failed");
    } finally { stderr.mockRestore(); }
  });
});
