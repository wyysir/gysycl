import { hasPermission } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessDocument,
  canEditDocument,
  requireUser,
  requireOrigin,
} from "@/server/auth";
import { enqueueOcr } from "@/server/documents";
import { getReadyDb } from "@/lib/bootstrap";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    const { id } = await context.params;
    const db = await getReadyDb();
    const document = await db.document.findUnique({ where: { id } });
    if (!document) {
      return NextResponse.json({ error: "单据不存在" }, { status: 404 });
    }
    if (document.status === "PROCESSING" && Date.now()-document.updatedAt.getTime()<5*60*1000) {
      return NextResponse.json({error:"识别正在进行，请稍候；超过5分钟未完成可手动重试"},{status:409});
    }
    if (!canAccessDocument(user, document) || !canEditDocument(user, document) || !hasPermission(user,"document.ocr",document.projectId)) {
      return NextResponse.json({ error: "无权重试该单据识别" }, { status: 403 });
    }
    // 待审核/已通过单据的数据正在审批或已生效，不允许重新识别覆盖。
    if (!["PROCESSING", "DRAFT", "NEEDS_REVISION"].includes(document.status)) {
      return NextResponse.json(
        { error: "当前状态不允许重新识别" },
        { status: 409 },
      );
    }
    const queue = await enqueueOcr(id);
    return NextResponse.json({ ok: true, queue });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
