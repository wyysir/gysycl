import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { ApiError, apiErrorResponse, requireOrigin } from "./auth";
import { captureRequestData } from "./observability/logger";

export async function parseJson<T>(
  request: NextRequest,
  schema: ZodType<T>,
): Promise<T> {
  requireOrigin(request);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ApiError(400, "请求 JSON 格式错误");
  }
  captureRequestData(payload);
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(400, "请求参数不合法", result.error.flatten());
  }
  return result.data;
}

export function handleApiError(error: unknown) {
  return apiErrorResponse(error);
}

export function binaryResponse(
  data: Uint8Array | Buffer,
  contentType: string,
  extraHeaders: Record<string, string> = {},
) {
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
