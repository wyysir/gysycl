"use client";

import { hasPermission } from "@/lib/permissions";
import { canOpenNavigation, documentOrigin, mobileNavigation } from "@/lib/client/navigation";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  CheckSquare2,
  Database,
  FileText,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
  Package,
  MoreHorizontal,
  ChevronLeft,
} from "lucide-react";
import type { User } from "@/lib/client/types";
import { api } from "@/lib/client/api";
import { BrandLogo } from "./BrandProvider";
import { useProtectedNavigation } from "./LeaveProtection";
import { clearDrafts, draftTab, listDrafts } from "@/lib/client/draft-store";

const navItems = [
  { href: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { href: "/upload", label: "新建单据", icon: Plus },
  { href: "/documents", label: "单据中心", icon: FileText },
  { href: "/reviews", label: "审核队列", icon: CheckSquare2 },
  { href: "/business", label: "项目经营", icon: Building2 },
  { href: "/analytics", label: "价格分析", icon: BarChart3 },
  { href: "/ingredients", label: "原材料", icon: Package },
  { href: "/master", label: "供应商与合同", icon: Database },
  { href: "/settings", label: "系统设置", icon: Settings },
];

const pageTitles: Record<string, string> = {
  batches: "批次核对",
  feedback: "反馈建议",
  dashboard: "工作台",
  upload: "新建单据",
  documents: "单据中心",
  reviews: "审核队列",
  analytics: "价格分析",
  business: "项目经营",
  master: "供应商与合同",
  ingredients: "原材料",
  settings: "系统设置",
};

function roleLabel(user: User) {
  if (user.globalRole === "ADMIN") return "系统管理员";
  if (user.globalRole === "FINANCE") return "财务只读";
  if (
    user.memberships.some((membership) =>
      membership.roles.includes("SUPERVISOR"),
    )
  ) {
    return "项目主管";
  }
  return user.memberships.flatMap(membership=>membership.roleNames || []).filter((name,index,all)=>all.indexOf(name)===index).join(" / ") || "项目员工";
}

export function AppShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const documentSource = searchParams.get("from") || "";
  const origin = documentOrigin(documentSource);
  const uploadReturn = documentSource === "documents" ? "/documents" : "/dashboard";
  const router = useRouter();
  const requestNavigation = useProtectedNavigation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    setUserMenuOpen(false);
    setMoreOpen(false);

  }, [pathname, documentSource]);
  const firstSegment = pathname.split("/").filter(Boolean)[0] || "dashboard";
  const title =
    firstSegment === "documents" && pathname.includes("/documents/")
      ? documentSource === "reviews" ? "主管审核" : "核对明细"
      : pageTitles[firstSegment] || "工作台";
  const canSubmit = hasPermission(user, "document.create");
  const isTask = pathname === "/upload" || pathname.startsWith("/documents/") || pathname.startsWith("/batches/");
  const visibleItems = navItems.filter(item => canOpenNavigation(user, item.href));
  const mobilePaths = mobileNavigation(user, visibleItems.map(item => item.href));
  const mobileItems = mobilePaths.map(path => visibleItems.find(item => item.href === path)!).filter(Boolean);


  async function logout() {
    requestNavigation(async () => {
      if ((await listDrafts(user.id, draftTab())).length && !window.confirm("退出登录会清除当前账号的未提交恢复副本，确认退出？")) return;
      await clearDrafts(user.id);
      await api.post("/api/auth/logout");
      try { Object.keys(sessionStorage).filter(key => key.startsWith("page:") || key.startsWith("scroll:")).forEach(key => sessionStorage.removeItem(key)); } catch {}
      router.replace("/login");
    }, false);
  }

  const nav = (mobile = false) =>
    (mobile ? mobileItems : visibleItems).map((item) => {
      const Icon = item.icon;
      const active =
        pathname === item.href ||
        (item.href === (documentSource === "reviews" ? "/reviews" : "/documents") && pathname.startsWith("/documents/"));
      return (
        <Link
          key={item.href}
          href={item.href === "/upload" && pathname === "/documents" ? "/upload?from=documents" : item.href}
          className={`nav-item ${mobile && item.href === "/upload" ? "mobile-new" : ""} ${active ? "is-active" : ""}`}
          aria-current={active ? "page" : undefined}
        >
          <span className="nav-icon">
            <Icon size={mobile ? 17 : 18} />
          </span>
          <span>{mobile && item.href === "/reviews" ? "审核" : item.label}</span>
        </Link>
      );
    });

  return (
    <div className={`shell ${isTask ? "shell--task" : ""} ${pathname === "/upload" ? "shell--upload" : ""} ${pathname.startsWith("/documents/") ? "shell--document" : ""}`}>
      <aside className="sidebar">
        <Link href="/dashboard" className="login-brand">
          <BrandLogo />
        </Link>
        <div className="sidebar-project">
          <span>当前数据范围</span>
          <strong>
            {user.globalRole === "ADMIN" || user.globalRole === "FINANCE"
              ? "全公司项目点"
              : user.memberships.map((item) => item.projectName).join("、")}
          </strong>
        </div>
        <nav className="nav">{nav().map((item, index) => <span className="nav-entry" key={item.key}>{index === visibleItems.findIndex(row => ["/ingredients", "/master", "/settings"].includes(row.href)) && <span className="nav-section-label">基础资料</span>}{item}</span>)}</nav>
        <div className="sidebar-footer">
          <div className="user-card">
            <div className="avatar">{user.name.slice(0, 1)}</div>
            <div className="user-meta">
              <strong>{user.name}</strong>
              <span>{roleLabel(user)}</span>
            </div>
            <button
              className="icon-button icon-button--dark"
              type="button"
              title="退出登录"
              onClick={logout}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="mobile-brand">
            {pathname === "/upload" && <><Link className="upload-mobile-back" href={uploadReturn} aria-label={uploadReturn === "/documents" ? "返回单据中心" : "返回工作台"}><ChevronLeft size={24} /></Link><strong className="upload-mobile-title">新建单据</strong></>}
            <Link href="/dashboard" aria-label="返回工作台"><BrandLogo compact /></Link>
          </div>
          <div className="breadcrumb">
            <Link href={pathname.startsWith("/documents/") ? origin.href : "/dashboard"}>{pathname.startsWith("/documents/") ? origin.label : "工作台"}</Link>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <Link className="feedback-entry" href="/feedback">反馈建议</Link>
            <span className="pill pill--info">
              {new Intl.DateTimeFormat("zh-CN", {
                timeZone: "Asia/Shanghai",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date())}
            </span>
            {canSubmit && !isTask ? (
              <Link className="btn btn--primary btn--small" href={pathname === "/documents" ? "/upload?from=documents" : "/upload?from=dashboard"}>
                <Plus size={14} /> 新建单据
              </Link>
            ) : null}
            <div className="mobile-user">
              <button
                className="mobile-user-button"
                type="button"
                title="账号菜单"
                aria-label="账号菜单"
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <span className="header-employee-name" title={user.name}>{Array.from(user.name).slice(0, 5).join("")}</span>
              </button>
              {userMenuOpen ? (
                <div className="mobile-user-panel">
                  <strong>{user.name}</strong>
                  <span>{roleLabel(user)}</span>
                  <button
                    className="btn btn--outline btn--small"
                    type="button"
                    onClick={logout}
                  >
                    <LogOut size={14} /> 退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        {children}
      </main>
      {moreOpen ? (
        <div
          className="mobile-more-backdrop"
          onClick={() => setMoreOpen(false)}
        >
          <nav
            className="mobile-more-panel"
            aria-label="更多功能"
            onClick={(event) => event.stopPropagation()}
          >
            {visibleItems
              .filter(item => !mobilePaths.includes(item.href))
              .map((item) => (
                <Link className="nav-item" key={item.href} href={item.href}>
                  <item.icon size={18} />
                  {item.label}
                </Link>
              ))}
            <Link className="nav-item" href="/feedback">反馈建议</Link>
          </nav>
        </div>
      ) : null}
      <nav className="mobile-nav" aria-label="手机主导航">
        {nav(true)}
        <button
          type="button"
          className={`nav-item ${moreOpen ? "is-active" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <span className="nav-icon">
            <MoreHorizontal size={18} />
          </span>
          <span>更多</span>
        </button>
      </nav>
    </div>
  );
}
