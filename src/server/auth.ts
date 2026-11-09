import { builtinPermissions, canViewRecord, hasPermission, canEditRecord, canReviewRecord, type Permission } from "@/lib/permissions";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import type { GlobalRole, ProjectRole } from "@/generated/prisma/client";
import { env } from "@/lib/config";
import { getReadyDb } from "@/lib/bootstrap";
import { ApiError } from "./errors";

export { ApiError };

const SESSION_COOKIE = "delivery_session";
const BIND_COOKIE = "delivery_bind";
const secret = new TextEncoder().encode(env.SESSION_SECRET);

export type Membership = {
  projectId: string;
  projectName: string;
  projectCode: string;
  roles: ProjectRole[];
  permissions?: Permission[];
  roleNames?: string[];
};

export type SessionUser = {
  id: string;
  employeeNo: string;
  name: string;
  globalRole: GlobalRole;
  memberships: Membership[];
};

function userInclude() {
  return {
    memberships: {
      include: {
        project: { select: { id: true, name: true, code: true, active: true } },
        customRole: true,
      },
    },
  } as const;
}

async function toSessionUser(user: {
  id: string;
  employeeNo: string;
  name: string;
  globalRole: GlobalRole;
  memberships: Array<{
    projectId: string;
    role: ProjectRole;
    project: { id: string; name: string; code: string; active: boolean };
    customRoleId: string | null;
    customRole: { name: string; permissions: unknown; active: boolean } | null;
  }>;
}): Promise<SessionUser> {
  const membershipMap = new Map<string, Membership>();
  for (const membership of user.memberships) {
    if (!membership.project.active || membership.customRoleId && !membership.customRole?.active) continue;
    const custom = membership.customRole;
    const roles = custom ? [] : [membership.role];
    const permissions = custom
      ? (Array.isArray(custom.permissions) ? custom.permissions.filter((key): key is Permission => typeof key === "string") : [])
      : builtinPermissions(roles);
    const roleName = custom?.name || (membership.role === "SUPERVISOR" ? "项目主管" : "项目员工");
    const existing = membershipMap.get(membership.projectId);
    if (existing) {
      existing.roles.push(...roles);
      existing.permissions = [...new Set([...(existing.permissions || []), ...permissions])];
      existing.roleNames?.push(roleName);
    } else {
      membershipMap.set(membership.projectId, {
        projectId: membership.projectId,
        projectName: membership.project.name,
        projectCode: membership.project.code,
        roles, permissions, roleNames: [roleName],
      });
    }
  }
  return {
    id: user.id,
    employeeNo: user.employeeNo,
    name: user.name,
    globalRole: user.globalRole,
    memberships: Array.from(membershipMap.values()),
  };
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function createBindTicket(openid: string): Promise<string> {
  return new SignJWT({ openid, type: "wechat-bind" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyBindTicket(
  ticket: string,
): Promise<{ openid: string } | null> {
  try {
    const { payload } = await jwtVerify(ticket, secret);
    if (payload.type !== "wechat-bind" || typeof payload.openid !== "string") {
      return null;
    }
    return { openid: payload.openid };
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(BIND_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

async function userById(userId: string) {
  const db = await getReadyDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    include: userInclude(),
  });
  if (!user || !user.active || user.deletedAt) return null;
  return toSessionUser(user);
}

export async function getSessionUser(
  request?: NextRequest,
): Promise<SessionUser | null> {
  const token = request
    ? request.cookies.get(SESSION_COOKIE)?.value
    : (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== "session" || typeof payload.sub !== "string") {
      return null;
    }
    return userById(payload.sub);
  } catch {
    return null;
  }
}

export async function requireUser(
  request?: NextRequest,
): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw new ApiError(401, "请先登录");
  return user;
}

export async function authenticate(
  employeeNo: string,
  password: string,
): Promise<SessionUser | null> {
  const db = await getReadyDb();
  const { verifyPassword } = await import("@/lib/passwords");
  const user = await db.user.findUnique({
    where: { employeeNo: employeeNo.trim() },
    include: userInclude(),
  });
  if (!user || !user.active || user.deletedAt || !verifyPassword(password, user.passwordHash)) {
    return null;
  }
  return toSessionUser(user);
}

export function isGlobalReader(user: SessionUser): boolean {
  return user.globalRole === "ADMIN" || user.globalRole === "FINANCE";
}

export function isAdmin(user: SessionUser): boolean {
  return user.globalRole === "ADMIN";
}

export function canSubmitProject(user: SessionUser, projectId: string): boolean {
  return hasPermission(user, "document.create", projectId);
}

export function canSuperviseProject(user: SessionUser, projectId: string): boolean {
  return hasPermission(user, "document.approve", projectId) || hasPermission(user, "document.return", projectId);
}

export function canAccessProject(
  user: SessionUser,
  projectId: string,
): boolean {
  return (
    isGlobalReader(user) ||
    user.memberships.some((membership) => membership.projectId === projectId)
  );
}

export function allowedProjectIds(user: SessionUser): string[] | null {
  if (isGlobalReader(user)) return null;
  return Array.from(
    new Set(user.memberships.map((membership) => membership.projectId)),
  );
}

export function canAccessDocument(
  user: SessionUser,
  document: {projectId:string;createdById:string},
): boolean {
  return canViewRecord(user, document);
}

export function canEditDocument(
  user: SessionUser,
  document: { projectId: string; createdById: string; status: string },
): boolean {
  return canEditRecord(user, document);
}

export function canReviewDocument(user: SessionUser, document: { projectId: string; status: string; createdById?:string }): boolean {
  return canReviewRecord(user, document);
}

export function requireOrigin(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(env.APP_URL).origin;
  if (origin !== expected) {
    throw new ApiError(403, "请求来源校验失败");
  }
}

export function apiErrorResponse(error: unknown) {
  if(error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
    return NextResponse.json({error:'相同记录已存在，请刷新后复用已有记录',details:null},{status:409});
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, details: error.details || null },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
}
