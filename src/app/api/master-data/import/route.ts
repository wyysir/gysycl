import { z } from "zod";
import { importTypes } from "@/lib/master-import";
import { hasPermission } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { requireOrigin, requireUser } from "@/server/auth";
import { importMasterWorkbook } from "@/server/excel";
import { captureFormData } from "@/server/observability/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    requireOrigin(request);
    if (!hasPermission(user,"master.import")) {
      return NextResponse.json({ error: "当前角色没有导入基础资料权限" }, { status: 403 });
    }
    const form = await request.formData();
    captureFormData(form);
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择 Excel 文件" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 413 });
    }
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
    const result = await importMasterWorkbook(
      user,
      Buffer.from(await file.arrayBuffer()),
      dryRun,
      z.enum(importTypes).parse(request.nextUrl.searchParams.get("type") || "all"),
    );
    return NextResponse.json(result);
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
