import { getBrandImage } from "@/server/brand";
import { handleApiError } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const image = await getBrandImage();
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ETag: `"${image.sha256}"` } });
  } catch (error) { return handleApiError(error); }
}
