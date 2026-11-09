import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getReadyDb();
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "up",
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, database: "down" },
      { status: 503 },
    );
  }
}
