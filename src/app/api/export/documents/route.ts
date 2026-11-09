import { type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { buildDocumentsWorkbook } from "@/server/excel";
import { binaryResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const params = request.nextUrl.searchParams;
    const result = await buildDocumentsWorkbook(user, {
      from: params.get("from") || "",
      to: params.get("to") || "",
      projectId: params.get("projectId") || "",
      status: params.get("status") || "",
    });
    return binaryResponse(
      result.buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      {
        "Content-Disposition": `attachment; filename="documents-export.xlsx"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      },
    );
  } catch (error) {
    const { handleApiError } = await import("@/server/http");
    return handleApiError(error);
  }
}
