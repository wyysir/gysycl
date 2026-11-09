import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/client/api";

afterEach(() => vi.unstubAllGlobals());

describe("authentication error handling", () => {
  it.each(["/api/auth/login", "/api/auth/wechat/bind"])("keeps %s validation errors on the current form", async (url) => {
    const location = { href: "/login" };
    vi.stubGlobal("window", { location });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "工号或密码错误" }), { status: 401, headers: { "Content-Type": "application/json" } })));
    await expect(api.post(url, {})).rejects.toMatchObject({ status: 401, message: "工号或密码错误" });
    expect(location.href).toBe("/login");
  });
  it("redirects an expired business request to the login page", async () => {
    const location = { href: "/documents" };
    vi.stubGlobal("window", { location });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "Content-Type": "application/json" } })));
    await expect(api.get("/api/documents")).rejects.toMatchObject({ status: 401 });
    expect(location.href).toBe("/login?expired=1");
  });
});
