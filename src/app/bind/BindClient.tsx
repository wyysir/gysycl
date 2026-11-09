"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandProvider";
import { api } from "@/lib/client/api";

export function BindClient({ ticket }: { ticket: string }) {
  const router = useRouter();
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/api/auth/wechat/bind", {
        ticket,
        employeeNo,
        password,
      });
      router.replace("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "绑定失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <BrandLogo />
        </div>
        <div className="login-copy">
          <div className="eyebrow">首次进入 · 微信绑定</div>
          <h1>
            一次绑定，
            <br />
            <em>之后免登录。</em>
          </h1>
          <p>
            绑定后，可从公众号菜单进入系统并自动登录。员工号由管理员预先创建。
          </p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>绑定员工身份</h2>
          <p>请输入管理员分配的员工号和密码。</p>
          {!ticket ? (
            <div className="notice notice--red">
              绑定凭证缺失或已过期，请重新从公众号菜单进入。
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="bindEmployeeNo">员工号</label>
                <input
                  className="input"
                  id="bindEmployeeNo"
                  value={employeeNo}
                  onChange={(event) => setEmployeeNo(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="bindPassword">密码</label>
                <input
                  className="input"
                  id="bindPassword"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
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
                disabled={loading}
              >
                {loading ? "正在绑定…" : "确认绑定"}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
