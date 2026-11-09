import { documentReadScope } from "@/server/read-scope";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, canSubmitProject, requireOrigin, allowedProjectIds, ApiError } from "@/server/auth";
import { getReadyDb } from "@/lib/bootstrap";
import { listDocuments } from "@/server/document-service";
import { createDocument, createManualDocument, enqueueOcr } from "@/server/documents";
import { parseDateOnly } from "@/lib/text";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const params = request.nextUrl.searchParams;
    return NextResponse.json({
      documents: await listDocuments(user, {
        q: params.get("q") || "",
        status: params.get("status") || "",
        from: params.get("from") || "",
        to: params.get("to") || "",
        projectId: params.get("projectId") || "",
        supplierId: params.get("supplierId") || "",
        limit: Number(params.get("limit")) || 80,
      }),
    });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}

const createSchema = z.discriminatedUnion("entryMode", [z.object({
  entryMode: z.literal("MANUAL"),
  projectId: z.string().min(1),
  docDate: z.string().min(8),
}), z.object({
  entryMode: z.literal("OCR"),
  projectId: z.string().min(1),
  docDate: z.string().min(8),
  pages: z
    .array(
      z.object({
        objectKey: z.string().startsWith("documents/"),
        mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
        fileName: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(5),
})]);

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const body = await parseJson(request, z.preprocess(
      value => value && typeof value === "object" ? { entryMode: "OCR", ...value } : value,
      createSchema,
    ));
    if (!canSubmitProject(user, body.projectId)) {
      return NextResponse.json({ error: "无权在该项目点上传单据" }, { status: 403 });
    }
    if (!await (await getReadyDb()).project.findFirst({where: {id: body.projectId, active: true}})) throw new ApiError(400, "项目不存在或已停用");
    const docDate = parseDateOnly(body.docDate);
    if (!docDate) return NextResponse.json({ error: "单据日期无效" }, { status: 400 });
    if (body.entryMode === "MANUAL") {
      const document = await createManualDocument({ userId: user.id, projectId: body.projectId, docDate });
      return NextResponse.json({ id: document.id, status: document.status }, { status: 201 });
    }
    const allowed = allowedProjectIds(user);
    if (body.pages.some(page=>page.objectKey.startsWith("documents/batches/"))) throw new ApiError(400,"批次图片只能在原批次创建单据");
    if (allowed) {
      const db = await getReadyDb();
      const inaccessiblePage = await db.documentPage.findFirst({
        where: {
          objectKey: { in: body.pages.map((page) => page.objectKey) },
          document: { NOT:documentReadScope(user) },
        },
      });
      if (inaccessiblePage) throw new ApiError(403, "无权使用其他项目点的图片");
    }
    const document = await createDocument({
      userId: user.id,
      projectId: body.projectId,
      docDate,
      pages: body.pages,
    });
    const queue = await enqueueOcr(document.id);
    return NextResponse.json(
      { id: document.id, status: "PROCESSING", queue },
      { status: 201 },
    );
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
