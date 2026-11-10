import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const options = new Map<string, string>();
const allowed = new Set(["dir", "request", "job", "level", "event", "since", "limit"]);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, ""), value = process.argv[i + 1];
  if (!allowed.has(key) || !value || value.startsWith("--")) throw new Error("用法: npm run logs -- [--request 编号] [--level error] [--event db.error] [--since ISO时间] [--limit 200] [--dir 目录]");
  options.set(key, value);
}
const directory = options.get("dir") || process.env.APP_LOG_DIR || path.resolve(".data/logs");
const limit = Number(options.get("limit") || 200);
if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error("limit 必须是 1～10000");
const since = options.has("since") ? Date.parse(options.get("since")!) : 0;
if (!Number.isFinite(since)) throw new Error("since 必须是有效时间");
const output: { time: number; line: string }[] = [];
let malformed = 0;
try {
  for (const name of await readdir(directory)) {
    if (!/^(web|worker)-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}-\d+\.jsonl$/.test(name)) continue;
    const file = path.join(directory, name);
    if (!(await stat(file)).isFile()) continue;
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      try {
        const row = JSON.parse(line);
        const time = Date.parse(row.timestamp);
        if (!Number.isFinite(time) || time < since) continue;
        if ([ ["request", "request_id"], ["job", "job_id"], ["level", "level"], ["event", "event"] ].some(([option, field]) => options.has(option) && row[field] !== options.get(option))) continue;
        output.push({ time, line });
        output.sort((a, b) => a.time - b.time);
        if (output.length > limit) output.shift();
      } catch { malformed++; }
    }
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  process.stderr.write("日志目录尚未生成。\n");
}
for (const row of output) process.stdout.write(row.line + "\n");
if (malformed) process.stderr.write(`已跳过 ${malformed} 条不完整记录。\n`);
