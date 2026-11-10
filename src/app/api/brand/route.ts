import { NextResponse, type NextRequest } from "next/server";
import { getBrand, maxLogoBytes, saveBrand } from "@/server/brand";
import { requireOrigin, requireUser } from "@/server/auth";
import { ApiError } from "@/server/errors";
import { handleApiError } from "@/server/http";
import { captureFormData } from "@/server/observability/logger";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await getBrand(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleApiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    requireOrigin(request);
    const user = await requireUser(request);
    if (user.globalRole !== "ADMIN") throw new ApiError(403, "只有管理员可以修改企业Logo");
    if (Number(request.headers.get("content-length")) > maxLogoBytes + 65536) throw new ApiError(413, "Logo不能超过2MB");
    const form = await request.formData();
    captureFormData(form);
    const file = form.get("logo");
    if (!(file instanceof File) || file.size > maxLogoBytes) throw new ApiError(400, "请选择2MB以内的Logo图片");
    return NextResponse.json(await saveBrand(user, Buffer.from(await file.arrayBuffer()), Number(form.get("version"))));
  } catch (error) { return handleApiError(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    requireOrigin(request);
    const user = await requireUser(request);
    const body = await request.json();
    return NextResponse.json(await saveBrand(user, null, Number(body.version)));
  } catch (error) { return handleApiError(error); }
}
