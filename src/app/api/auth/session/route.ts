import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getReadyDb } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await getReadyDb();
  const user = await getSessionUser();
  return NextResponse.json({ user });
}
