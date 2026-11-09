import { hasPermission } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { canSuperviseProject, isAdmin, requireUser } from "@/server/auth";
import { listDocuments } from "@/server/document-service";
import { thresholds } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (user.globalRole === "FINANCE") {
      return NextResponse.json(
        { error: "财务账号只读，不能审核" },
        { status: 403 },
      );
    }
    if (!hasPermission(user,"document.approve") && !hasPermission(user,"document.return")) {
      return NextResponse.json({error:"当前角色没有审核权限"},{status:403});
    }
    const [pending, returned] = await Promise.all([
      listDocuments(user, { status: "PENDING_REVIEW", limit: 200 }),
      listDocuments(user, { status: "NEEDS_REVISION", limit: 200 }),
    ]);
    return NextResponse.json({
      user,
      confidenceThreshold: thresholds.ocrConfidence,
      pending: pending.filter((document) =>
        canSuperviseProject(user, document.projectId),
      ),
      returned: returned.filter((document) =>
        canSuperviseProject(user, document.projectId),
      ),
    });
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
