import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { env, isWechatConfigured } from "@/lib/config";
import { wechatAuthorizeUrl } from "@/server/wechat";

export const runtime = "nodejs";

export async function GET() {
  if (!isWechatConfigured) {
    return NextResponse.redirect(
      new URL("/login?wechat=unconfigured", env.APP_URL),
    );
  }
  const state = crypto.randomBytes(20).toString("base64url");
  const response = NextResponse.redirect(wechatAuthorizeUrl(state));
  response.cookies.set("wechat_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
