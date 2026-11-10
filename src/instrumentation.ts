import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordError } = await import("./server/observability/logger");
    recordError("next.request_error", error, { method: request.method, route: context.routePath, route_type: context.routeType });
  }
};
