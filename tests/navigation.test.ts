import { describe, expect, it } from "vitest";
import { canOpenNavigation, documentOrigin, mobileNavigation } from "@/lib/client/navigation";
import type { PermissionUser } from "@/lib/permissions";

const staff = (permissions: string[]): PermissionUser => ({ globalRole: "STAFF", memberships: [{ projectId: "p", roles: [], permissions }] });
describe("navigation uses existing permissions", () => {
  it("hides privileged entries for a minimal custom role", () => {
    const user = staff([]);
    for (const path of ["/upload", "/reviews", "/business", "/analytics", "/ingredients", "/master", "/settings"]) expect(canOpenNavigation(user, path)).toBe(false);
    expect(mobileNavigation(user, ["/dashboard", "/documents"])).toEqual(["/dashboard", "/documents"]);
  });
  it("puts creation in the middle and uses authorized analysis when review is unavailable", () => {
    const user = staff(["document.create", "analytics.view"]);
    expect(mobileNavigation(user, ["/dashboard", "/upload", "/documents", "/analytics"])).toEqual(["/dashboard", "/documents", "/upload", "/analytics"]);
    expect(canOpenNavigation(user, "/settings")).toBe(false);
  });
  it("keeps finance read-only and review entries for reviewers", () => {
    const finance: PermissionUser = { globalRole: "FINANCE", memberships: [] };
    expect(canOpenNavigation(finance, "/upload")).toBe(false);
    expect(canOpenNavigation(finance, "/master")).toBe(true);
    expect(mobileNavigation(staff(["document.return", "document.create"]), ["/reviews", "/upload"])).toContain("/reviews");
  });
  it("uses the actual source for breadcrumbs and rejects arbitrary destinations", () => {
    expect(documentOrigin("reviews")).toEqual({ href: "/reviews", label: "审核队列" });
    expect(documentOrigin("analytics").href).toBe("/analytics");
    expect(documentOrigin("https://outside.invalid").href).toBe("/documents");
  });
});
