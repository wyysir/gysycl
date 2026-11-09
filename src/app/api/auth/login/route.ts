import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticate, createSessionToken, setSessionCookie } from "@/server/auth";
import { getReadyDb } from "@/lib/bootstrap";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";

const loginSchema = z.object({
  employeeNo: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
});

const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export async function POST(request: NextRequest) {
  try {
    await getReadyDb();
    const key = clientKey(request);
    const current = attempts.get(key);
    if (current && current.resetAt > Date.now() && current.count >= 10) {
      return NextResponse.json(
        { error: "登录失败次数过多，请 15 分钟后再试" },
        { status: 429 },
      );
    }
    const body = await parseJson(request, loginSchema);
    const user = await authenticate(body.employeeNo, body.password);
    if (!user) {
      const next =
        current && current.resetAt > Date.now()
          ? { count: current.count + 1, resetAt: current.resetAt }
          : { count: 1, resetAt: Date.now() + 15 * 60 * 1000 };
      attempts.set(key, next);
      return NextResponse.json({ error: "工号或密码错误" }, { status: 401 });
    }
    attempts.delete(key);
    const response = NextResponse.json({ user });
    setSessionCookie(response, await createSessionToken(user.id));
    return response;
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
