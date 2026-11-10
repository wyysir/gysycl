import { performance } from "node:perf_hooks";
import type { SqlDriverAdapterFactory, SqlQueryable, SqlQuery } from "@prisma/driver-adapter-utils";
import { logEvent, recordError } from "./logger";
import { safeSql } from "./redaction";

async function observe<T>(operation: string, sql: string, count: number, execute: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await execute();
    const duration = Math.round((performance.now() - started) * 100) / 100;
    const slow = duration >= Number(process.env.LOG_SLOW_SQL_MS || 500);
    const mode = process.env.LOG_SQL_MODE || "all";
    if (mode === "all" || mode === "slow" && slow) logEvent(slow ? "warn" : "info", "db.query", { operation, sql: safeSql(sql), parameter_count: count, duration_ms: duration, slow });
    return result;
  } catch (error) {
    recordError("db.error", error, { operation, sql: safeSql(sql), parameter_count: count, duration_ms: Math.round((performance.now() - started) * 100) / 100 }, true);
    throw error;
  }
}

function queryable<T extends SqlQueryable>(target: T): T {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if ((property === "queryRaw" || property === "executeRaw") && typeof value === "function") {
        return (query: SqlQuery) => observe(property, query.sql, query.args.length, () => value.call(object, query));
      }
      if (property === "startTransaction" && typeof value === "function") {
        return async (...args: unknown[]) => queryable(await observe<SqlQueryable>("begin", "BEGIN", 0, () => value.apply(object, args)));
      }
      if (["commit", "rollback", "executeScript", "createSavepoint", "rollbackToSavepoint", "releaseSavepoint"].includes(String(property)) && typeof value === "function") {
        return (...args: unknown[]) => observe(String(property), property === "executeScript" ? String(args[0]) : String(property).toUpperCase(), 0, () => value.apply(object, args));
      }
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

/** Instrument the driver boundary so SQL and request context remain correlated. */
export function observeDatabase<T extends SqlDriverAdapterFactory>(factory: T): T {
  return new Proxy(factory, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if ((property === "connect" || property === "connectToShadowDb") && typeof value === "function") {
        return async () => queryable(await observe<SqlQueryable>("connect", "CONNECT", 0, () => value.call(target)));
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
