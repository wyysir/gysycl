import { NextResponse, type NextRequest } from "next/server";
import {
  sniffImageMime,
  verifyUploadToken,
  writeLocalObject,
} from "@/server/storage";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") || "";
  const mime = request.nextUrl.searchParams.get("mime") || "";
  const expiresAt = Number(request.nextUrl.searchParams.get("expiresAt"));
  const token = request.nextUrl.searchParams.get("token") || "";
  if (!key.startsWith("documents/") || !verifyUploadToken(key, mime, expiresAt, token)) {
    return NextResponse.json({ error: "上传地址无效或已过期" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "图片不能超过 15MB" }, { status: 413 });
  }
  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "图片不能超过 15MB" }, { status: 413 });
  }
  const actualMime = sniffImageMime(buffer);
  if (!actualMime || actualMime !== mime) {
    return NextResponse.json(
      { error: "文件内容与图片格式不一致" },
      { status: 400 },
    );
  }
  try {
    await writeLocalObject(key, buffer, key.startsWith("documents/batches/"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return NextResponse.json({error:"图片已上传，不能覆盖"}, {status:409});
    throw error;
  }
  return NextResponse.json({ ok: true });
}
