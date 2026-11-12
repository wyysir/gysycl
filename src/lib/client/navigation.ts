import { hasPermission, type PermissionUser } from "../permissions";

export function canOpenNavigation(user: PermissionUser, href: string) {
  const any = (...permissions: Parameters<typeof hasPermission>[1][]) => permissions.some(permission => hasPermission(user, permission));
  switch (href) {
    case "/upload": return any("document.create");
    case "/reviews": return any("document.approve", "document.return");
    case "/business": return any("revenue.view");
    case "/analytics": return any("analytics.view");
    case "/ingredients": return any("master.manage", "master.create", "master.create_global", "master.import");
    case "/master": return any("master.manage", "master.create", "master.create_global", "master.import", "contract.view_price", "contract.manage");
    case "/settings": return user.globalRole === "ADMIN";
    default: return href === "/dashboard" || href === "/documents";
  }
}

export function mobileNavigation(user: PermissionUser, visiblePaths: string[]) {
  const fallback = ["/reviews", "/analytics", "/business", "/ingredients", "/master"].find(path => visiblePaths.includes(path));
  return ["/dashboard", "/documents", ...(canOpenNavigation(user, "/upload") ? ["/upload"] : []), ...(fallback ? [fallback] : [])];
}

export function documentOrigin(from: string | null | undefined) {
  const origins: Record<string, { href: string; label: string }> = {
    reviews: { href: "/reviews", label: "审核队列" },
    dashboard: { href: "/dashboard", label: "工作台" },
    analytics: { href: "/analytics", label: "价格分析" },
    business: { href: "/business", label: "项目经营" },
    ingredients: { href: "/ingredients", label: "原材料" },
  };
  return origins[from || ""] || { href: "/documents", label: "单据中心" };
}
