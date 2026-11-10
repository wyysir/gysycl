import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { logStatus, recordError } from "@/server/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getReadyDb();
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "up",
      logging: logStatus(),
      time: new Date().toISOString(),
    });
  } catch (error) {
    recordError("health.failed", error);
    return NextResponse.json(
      { ok: false, database: "down" },
      { status: 503 },
    );
  }
}
