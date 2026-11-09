import { documentVisibility } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import path from "node:path";
import { getReadyDb } from "@/lib/bootstrap";
import { canAccessDocument, requireUser } from "@/server/auth";
import { readObject } from "@/server/storage";
import { binaryResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const key = request.nextUrl.searchParams.get("key") || "";
    if (!key) return NextResponse.json({ error: "缺少文件标识" }, { status: 400 });
    if (key.startsWith("demo/")) {
      return NextResponse.redirect(new URL("/sample-delivery.svg", request.url));
    }
    const db = await getReadyDb();
    const page = await db.documentPage.findFirst({
      where: {
        OR: [{ objectKey: key }, { processedObjectKey: key }],
      },
      include: { document: true },
    });
    if (!page) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    if (!canAccessDocument(user, page.document)) {
      return NextResponse.json({ error: "无权查看该文件" }, { status: 403 });
    }
    if (!documentVisibility(user,page.document.projectId).sourceImages) return NextResponse.json({error:"原图含单价及金额，需要同时具有这两项查看权限"},{status:403});
    const buffer = await readObject(key);
    const ext = path.extname(key).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".svg"
            ? "image/svg+xml"
            : "image/jpeg";
    return binaryResponse(buffer, mime, {
      "Cache-Control": "private, no-store",
    });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
