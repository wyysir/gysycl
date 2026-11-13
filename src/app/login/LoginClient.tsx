"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/client/api";
import { BrandLogo } from "@/components/BrandProvider";

export function LoginClient({
  initialError,
  wechatConfigured,
  demoMode,
  expired,
}: {
  initialError: string;
  wechatConfigured: boolean;
  demoMode: boolean;
  expired: boolean;
}) {
  const router = useRouter();
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    initialError ||
      (expired ? "登录已过期，请重新进入。" : ""),
  );
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/api/auth/login", { employeeNo, password });
      router.replace("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  function fill(employee: string, secret: string) {
    setEmployeeNo(employee);
    setPassword(secret);
    setError("");
  }

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <BrandLogo />
        </div>
        <div className="login-copy">
          <div className="eyebrow">餐饮供应链 · 单据核验</div>
          <h1>
            每一张送货单，
            <br />
            <em>都经得起核对。</em>
          </h1>
          <p>
            送货单识别与人工核对，供应商与品名匹配，合同价格核对和跨项目比价。识别结果请对照原图复核。
          </p>
          <div className="login-features">
            <span>智能单据识别</span>
            <span>项目主管审核</span>
            <span>跨供应商比价</span>
          </div>
        </div>
        <div className="login-features">
          <span>
            <ShieldCheck size={13} /> 数据私有存储
          </span>
          <span>
            <Sparkles size={13} /> OCR + 视觉模型
          </span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>进入工作台</h2>
          <p>
            {wechatConfigured
              ? "使用内部员工号登录，首次从公众号进入会自动绑定微信。"
              : "使用管理员分配的员工号和密码登录。"}
          </p>
          {wechatConfigured ? (
            <a className="btn btn--primary btn--wide" href="/api/auth/wechat/start">
              <MessageCircle size={16} /> 微信授权进入
            </a>
          ) : (
            <div className="notice">
              支持直接通过网页使用，输入员工号和密码即可进入工作台。
            </div>
          )}
          <div className="login-divider">
            <span>{wechatConfigured ? "或使用员工号密码" : "员工号登录"}</span>
          </div>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="employeeNo">员工号</label>
              <input
                className="input"
                id="employeeNo"
                autoComplete="username"
                value={employeeNo}
                onChange={(event) => setEmployeeNo(event.target.value)}
                placeholder="请输入员工号"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">密码</label>
              <input
                className="input"
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                required
              />
            </div>
            {error ? (
              <div className="notice notice--red" style={{ marginTop: 14 }}>
                {error}
              </div>
            ) : null}
            <button
              className="btn btn--primary login-submit"
              type="submit"
              disabled={loading}
            >
              {loading ? "正在登录…" : "登录系统"}
            </button>
          </form>
          {demoMode ? (
          <div className="demo-logins">
            <p>演示账号 · 一键填入</p>
            <div className="demo-buttons">
              <button
                className="demo-button"
                type="button"
                onClick={() => fill("admin", "admin123")}
              >
                管理员
              </button>
              <button
                className="demo-button"
                type="button"
                onClick={() => fill("supervisor", "super123")}
              >
                项目主管
              </button>
              <button
                className="demo-button"
                type="button"
                onClick={() => fill("site_sh", "site123")}
              >
                项目采购
              </button>
            </div>
          </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
