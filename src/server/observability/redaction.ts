const sensitiveKey = /password|passwd|secret|token|authorization|cookie|credential|session|access.?key|api.?key|phone|contact|email|openid|unionid|密码|验证码/i;
const maxString = 1200;
const authCodeKey = /^(code|state|ticket|signature|sign)$/i;

export function privateValues(value: unknown, result: string[] = [], depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 5 || result.length >= 64) return result;
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    if ((sensitiveKey.test(key) || authCodeKey.test(key)) && typeof entry === "string" && entry.length >= 3) result.push(entry);
    else if (typeof entry === "object") privateValues(entry, result, depth + 1);
  }
  return result;
}

export function cleanText(value: string, secrets: readonly string[] = []): string {
  let text = value;
  for (const secret of secrets) if (secret.length >= 3) text = text.split(secret).join("[REDACTED]");
  text = text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|LTAI[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{24,})\b/g, "[REDACTED]")
    .replace(/((?:password|secret|token|api[_-]?key|access[_-]?key|signature|code)[\s"']*[:=][\s"']*)[^\s&;,"'}]+/gi, "$1[REDACTED]");
  return text.length > maxString ? text.slice(0, maxString) + "…[truncated]" : text;
}

export function redact(value: unknown, secrets: readonly string[] = [], depth = 0, hideAuthCodes = false): unknown {
  if (depth > 5) return "[depth limit]";
  if (typeof value === "string") return cleanText(value, secrets);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return { binaryBytes: value.byteLength };
  if (Array.isArray(value)) return [...value.slice(0, 30).map(entry => redact(entry, secrets, depth + 1, hideAuthCodes)), ...(value.length > 30 ? [`[${value.length - 30} more items]`] : [])];
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = Object.create(null);
  const entries = Object.entries(value);
  for (const [key, entry] of entries.slice(0, 50)) result[key] = sensitiveKey.test(key) || hideAuthCodes && authCodeKey.test(key) ? "[REDACTED]" : redact(entry, secrets, depth + 1, hideAuthCodes);
  if (entries.length > 50) result.__truncatedFields = entries.length - 50;
  return result;
}

/** Keep identifiers and placeholders, remove SQL literals and comments. */
export function safeSql(sql: string): string {
  return sql.replace(/"(?:""|[^"])*"|(?:E|U&)?'(?:''|\\[\s\S]|[^'])*(?:'|$)|\$([A-Za-z_][A-Za-z0-9_]*|)\$[\s\S]*?(?:\$\1\$|$)|\/\*[\s\S]*?(?:\*\/|$)|--[^\r\n]*/gi, match => match.startsWith('"') ? match : "?")
    .replace(/(?<![\w$])[-+]?\d+(?:\.\d+)?\b/g, "?").replace(/\s+/g, " ").trim().slice(0, 6000);
}

const reasons: Record<string, string> = {
  "23505": "唯一约束冲突", "23503": "外键引用不存在或仍被引用", "23502": "必填字段为空",
  "22003": "数值超出范围", "22P02": "数据类型或格式无效", "40001": "事务并发冲突",
  "40P01": "事务死锁", "57014": "语句被取消或超时", "53300": "数据库连接数已满",
  "42P01": "数据表不存在", "42703": "字段不存在", P2002: "唯一约束冲突", P2025: "记录不存在",
  P2028: "事务已关闭或超时", ECONNREFUSED: "数据库连接被拒绝", ETIMEDOUT: "数据库连接超时", ENOTFOUND: "数据库主机解析失败",
};
export function errorDetails(error: unknown, secrets: readonly string[] = [], database = false, depth = 0): Record<string, unknown> {
  if (depth > 3) return { message: "[cause depth limit]" };
  if (!error || typeof error !== "object") return { message: database ? "数据库操作失败" : cleanText(String(error), secrets) };
  const item = error as { name?: string; code?: string; originalCode?: string; message?: string; stack?: string; cause?: unknown; meta?: { driverAdapterError?: unknown } };
  const code = String(item.code || item.originalCode || "");
  database ||= /Prisma|DriverAdapter/i.test(item.name || "") || /^P\d{4}$/.test(code);
  const result: Record<string, unknown> = {
    name: cleanText(item.name || "Error", secrets),
    ...(code && { code: cleanText(code, secrets) }),
    message: database ? reasons[code] || "数据库操作失败，查看SQL、错误码及cause定位" : cleanText(item.message || "未知错误", secrets),
    stack: item.stack?.split("\n").filter(line => /^\s+at /.test(line)).slice(0, 10).map(line => cleanText(line, secrets)),
  };
  const cause = item.cause || item.meta?.driverAdapterError;
  if (cause) result.cause = errorDetails(cause, secrets, database, depth + 1);
  return result;
}
