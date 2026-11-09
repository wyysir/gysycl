import { NextResponse, type NextRequest } from "next/server";
import { env, isWechatConfigured } from "@/lib/config";
import { getReadyDb } from "@/lib/bootstrap";
import {
  createBindTicket,
  createSessionToken,
  setSessionCookie,
} from "@/server/auth";
import { exchangeWechatCode } from "@/server/wechat";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, env.APP_URL),
    );
  if (!isWechatConfigured) return fail("微信服务号未配置");
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const expectedState = request.cookies.get("wechat_oauth_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("微信授权状态校验失败，请重新进入");
  }
  try {
    const { openid, unionid } = await exchangeWechatCode(code);
    const db = await getReadyDb();
    const binding = await db.wechatBinding.findUnique({
      where: { openid },
      include: { user: true },
    });
    if (binding?.user.active) {
      const response = NextResponse.redirect(new URL("/dashboard", env.APP_URL));
      setSessionCookie(response, await createSessionToken(binding.userId));
      response.cookies.set("wechat_oauth_state", "", { path: "/", maxAge: 0 });
      return response;
    }
    const ticket = await createBindTicket(openid);
    if (unionid) {
      const pending = await db.wechatBinding.findFirst({
        where: { unionid },
        include: { user: true },
      });
      if (pending?.user.active) {
        const response = NextResponse.redirect(
          new URL("/dashboard", env.APP_URL),
        );
        setSessionCookie(response, await createSessionToken(pending.userId));
        return response;
      }
    }
    return NextResponse.redirect(
      new URL(`/bind?ticket=${encodeURIComponent(ticket)}`, env.APP_URL),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "微信登录失败");
  }
}
