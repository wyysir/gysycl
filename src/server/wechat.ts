import { env, isWechatConfigured } from "@/lib/config";

export function wechatAuthorizeUrl(state: string): string {
  const redirectUri = encodeURIComponent(`${env.APP_URL}/api/auth/wechat/callback`);
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(
    env.WECHAT_APP_ID,
  )}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=${encodeURIComponent(
    state,
  )}#wechat_redirect`;
}

export async function exchangeWechatCode(code: string) {
  if (!isWechatConfigured) throw new Error("微信服务号参数未配置");
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.searchParams.set("appid", env.WECHAT_APP_ID);
  url.searchParams.set("secret", env.WECHAT_APP_SECRET);
  url.searchParams.set("code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const payload = (await response.json()) as {
    openid?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!response.ok || !payload.openid) {
    throw new Error(payload.errmsg || "微信授权失败");
  }
  return { openid: payload.openid, unionid: payload.unionid || "" };
}
