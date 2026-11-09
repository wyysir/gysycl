import { z } from "zod";
import { importTypes } from "@/lib/master-import";
import { hasPermission } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { buildMasterTemplate } from "@/server/excel";
import { binaryResponse } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!hasPermission(user,"master.import")) {
      return NextResponse.json({ error: "当前角色没有下载导入模板权限" }, { status: 403 });
    }
    const type = z.enum(importTypes).parse(request.nextUrl.searchParams.get("type") || "all");
    const buffer = await buildMasterTemplate(type);
    return binaryResponse(
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      {
        "Content-Disposition": `attachment; filename="${type}-template.xlsx"`,
      },
    );
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
