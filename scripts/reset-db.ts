import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.cwd(), ".data", "pglite");
if (!target.startsWith(path.resolve(process.cwd(), ".data"))) {
  throw new Error("拒绝删除非 .data 目录");
}
if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
}
console.log("本地 PGlite 数据库已清理，下次启动会重新建库。");
