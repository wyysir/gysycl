import crypto from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mode = vi.hoisted(() => ({ configured: true }));
vi.mock("@/lib/config", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, env: { ...original.env, APP_URL: "https://shian.dhcy.top", WECHAT_APP_ID: "wx-test-account", WECHAT_APP_SECRET: "test-only-existing-secret" }, get isWechatConfigured() { return mode.configured; } };
});

import { getReadyDb } from "@/lib/bootstrap";
import { createBindTicket, getSessionUser, verifyBindTicket } from "@/server/auth";
import { hashPassword } from "@/lib/passwords";
import { hasPermission } from "@/lib/permissions";
import { GET as start } from "@/app/api/auth/wechat/start/route";
import { GET as callback } from "@/app/api/auth/wechat/callback/route";
import { POST as bind } from "@/app/api/auth/wechat/bind/route";

beforeAll(async () => { await getReadyDb(); });
afterEach(() => { mode.configured = true; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const origin = "https://shian.dhcy.top";
const password = "Synthetic-wechat-binding-test-only";
const freshOpenid = () => "synthetic-" + crypto.randomUUID();
async function employee() {
  const db = await getReadyDb();
  return db.user.create({ data: { employeeNo: "wx-test-" + crypto.randomUUID(), name: "隔离微信测试员工", passwordHash: hashPassword(password), memberships: { create: { projectId: "prj_sh", role: "SUBMITTER" } } } });
}
function provider(openid: string) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.weixin.qq.com");
    expect(url.pathname).toBe("/sns/oauth2/access_token");
    expect(url.searchParams.get("grant_type")).toBe("authorization_code");
    return new Response(JSON.stringify({ openid }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function callbackRequest(state = "synthetic-state", expected = "synthetic-state", code = "synthetic-code") {
  const url = new URL("/api/auth/wechat/callback", origin);
  url.searchParams.set("state", state); url.searchParams.set("code", code);
  return new NextRequest(url, { headers: { cookie: "wechat_oauth_state=" + expected } });
}
async function bindRequest(ticket: string, employeeNo: string, suppliedPassword = password) {
  return bind(new NextRequest(origin + "/api/auth/wechat/bind", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ ticket, employeeNo, password: suppliedPassword }) }));
}

describe("WeChat OAuth and existing employee binding", () => {
  it("keeps password login available when real WeChat credentials are missing", async () => {
    mode.configured = false;
    const response = await start();
    expect(response.headers.get("location")).toBe(origin + "/login?wechat=unconfigured");
    expect(response.cookies.get("wechat_oauth_state")).toBeUndefined();
  });

  it("issues independent state and requests only silent webpage OAuth on the project domain", async () => {
    const first = await start(), second = await start();
    const url = new URL(first.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://open.weixin.qq.com/connect/oauth2/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(origin + "/api/auth/wechat/callback");
    expect(url.searchParams.get("scope")).toBe("snsapi_base");
    expect(url.searchParams.get("appid")).toBe("wx-test-account");
    expect(url.searchParams.get("state")).toBe(first.cookies.get("wechat_oauth_state")?.value);
    expect(first.cookies.get("wechat_oauth_state")?.value).not.toBe(second.cookies.get("wechat_oauth_state")?.value);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect(first.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(first.cookies.get("wechat_oauth_state")?.maxAge).toBe(600);
  });

  it.each([["wrong", "expected", "code"], ["same", "same", ""]])("rejects bad state or missing code before contacting WeChat", async (state, expected, code) => {
    const fetcher = provider(freshOpenid());
    const response = await callback(callbackRequest(state, expected, code));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.cookies.get("delivery_session")).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a signed bind ticket for an unbound WeChat without creating an employee or binding", async () => {
    const db = await getReadyDb(), openid = freshOpenid(); provider(openid);
    const usersBefore = await db.user.count();
    const response = await callback(callbackRequest());
    const url = new URL(response.headers.get("location")!);
    expect(url.origin + url.pathname).toBe(origin + "/bind");
    expect(await verifyBindTicket(url.searchParams.get("ticket")!)).toEqual({ openid });
    expect(await db.wechatBinding.findUnique({ where: { openid } })).toBeNull();
    expect(await db.user.count()).toBe(usersBefore);
    expect(response.cookies.get("delivery_session")).toBeUndefined();
  });

  it("binds an existing employee with the real password verifier and preserves project permissions", async () => {
    const db = await getReadyDb(), user = await employee(), openid = freshOpenid();
    const response = await bindRequest(await createBindTicket(openid), user.employeeNo);
    expect(response.status).toBe(200);
    expect(await db.wechatBinding.findUnique({ where: { openid } })).toMatchObject({ userId: user.id });
    const token = response.cookies.get("delivery_session")?.value; expect(token).toBeTruthy();
    const session = await getSessionUser(new NextRequest(origin + "/dashboard", { headers: { cookie: "delivery_session=" + token } }));
    expect(session?.id).toBe(user.id);
    expect(hasPermission(session!, "document.create", "prj_sh")).toBe(true);
    expect(hasPermission(session!, "document.create", "prj_hz")).toBe(false);
  });

  it("rejects wrong employee passwords and tampered tickets without writing a binding", async () => {
    const db = await getReadyDb(), user = await employee(), openid = freshOpenid(), ticket = await createBindTicket(openid);
    expect((await bindRequest(ticket, user.employeeNo, "wrong-password")).status).toBe(401);
    expect((await bindRequest(ticket + "tampered", user.employeeNo)).status).toBe(400);
    expect(await db.wechatBinding.findUnique({ where: { openid } })).toBeNull();
  });

  it("does not replace an employee's existing WeChat or assign an occupied WeChat to another employee", async () => {
    const db = await getReadyDb(), first = await employee(), second = await employee(), openid = freshOpenid();
    await db.wechatBinding.create({ data: { userId: first.id, openid } });
    expect((await bindRequest(await createBindTicket(freshOpenid()), first.employeeNo)).status).toBe(409);
    expect((await bindRequest(await createBindTicket(openid), second.employeeNo)).status).toBe(409);
    expect(await db.wechatBinding.findUnique({ where: { openid } })).toMatchObject({ userId: first.id });
    expect(await db.wechatBinding.findUnique({ where: { userId: second.id } })).toBeNull();
  });

  it("automatically signs in an already bound active employee on the next OAuth entry", async () => {
    const db = await getReadyDb(), user = await employee(), openid = freshOpenid();
    await db.wechatBinding.create({ data: { userId: user.id, openid } }); provider(openid);
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toBe(origin + "/dashboard");
    expect(response.cookies.get("delivery_session")?.value).toBeTruthy();
    expect(response.cookies.get("wechat_oauth_state")?.maxAge).toBe(0);
  });

  it("does not sign in or bind a disabled employee", async () => {
    const db = await getReadyDb(), user = await employee(), openid = freshOpenid();
    await db.wechatBinding.create({ data: { userId: user.id, openid } }); await db.user.update({ where: { id: user.id }, data: { active: false } }); provider(openid);
    const response = await callback(callbackRequest());
    expect(new URL(response.headers.get("location")!).pathname).toBe("/bind");
    expect(response.cookies.get("delivery_session")).toBeUndefined();
    expect((await bindRequest(await createBindTicket(openid), user.employeeNo)).status).toBe(401);
    expect(await db.wechatBinding.findUnique({ where: { openid } })).toMatchObject({ userId: user.id });
  });

  it("handles rejected WeChat codes without creating a session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }), { status: 200 })));
    const response = await callback(callbackRequest());
    const url = new URL(response.headers.get("location")!);
    expect(url.origin + url.pathname).toBe(origin + "/login");
    expect(url.searchParams.get("error")).toBe("invalid code");
    expect(response.cookies.get("delivery_session")).toBeUndefined();
  });
});
