import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { getAnalytics } from "@/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const params = request.nextUrl.searchParams;
    return NextResponse.json(
      await getAnalytics(user, {
        from: params.get("from") || "",
        to: params.get("to") || "",
        projectId: params.get("projectId") || "",
      }),
    );
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
