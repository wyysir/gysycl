import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/bootstrap";
import { ApiError, isAdmin, requireOrigin, requireUser } from "@/server/auth";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";

const schema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(80),
  region: z.string().trim().max(50).optional().default(""),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    if (!isAdmin(user)) throw new ApiError(403, "只有管理员可以新增项目点");
    const body = await parseJson(request, schema);
    const db = await getReadyDb();
    const existing = await db.project.findFirst({
      where: {
        OR: [{ code: body.code.toUpperCase() }, { name: body.name }],
      },
    });
    if (existing) throw new ApiError(409, "项目点编码或名称已存在");
    const project = await db.project.create({
      data: {
        code: body.code.toUpperCase(),
        name: body.name,
        region: body.region,
      },
    });
    await db.auditLog.create({
      data: {
        entityType: "project",
        entityId: project.id,
        userId: user.id,
        action: "project.created",
        afterValue: {
          code: project.code,
          name: project.name,
          region: project.region,
        },
      },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!isAdmin(user)) throw new ApiError(403, "只有管理员可以维护项目点");
    const db = await getReadyDb();
    return NextResponse.json({projects: await db.project.findMany({orderBy: {code: "asc"}})});
  } catch (error) { const { handleApiError } = await import("@/server/http"); return handleApiError(error); }
}
