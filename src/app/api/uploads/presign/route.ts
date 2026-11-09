import { hasPermission } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireOrigin } from "@/server/auth";
import { createUploadTarget } from "@/server/storage";
import { parseJson } from "@/server/http";

export const runtime = "nodejs";

const schema = z.object({
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive().max(15 * 1024 * 1024),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!hasPermission(user, "document.create")) {
      return NextResponse.json({error:"当前账号没有上传单据权限"},{status:403});
    }
    requireOrigin(request);
    const body = await parseJson(request, schema);
    const suffix =
      body.mime === "image/png" ? "png" : body.mime === "image/webp" ? "webp" : "jpg";
    const target = await createUploadTarget(body.mime, suffix);
    return NextResponse.json(target);
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
