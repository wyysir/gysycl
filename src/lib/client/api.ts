"use client";

export class ApiClientError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details: unknown = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith("/api/auth/") && typeof window !== "undefined") {
      window.location.href = "/login?expired=1";
    }
    throw new ApiClientError(
      response.status,
      typeof payload === "string" ? payload : payload?.error || "请求失败",
      payload?.details || null,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string, body?: unknown) =>
    request<T>(url, {method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body)}),
  form: <T>(url: string, form: FormData) =>
    request<T>(url, { method: "POST", body: form }),
};

export function uploadToTarget(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 120_000;
    Object.entries(headers).forEach(([key, value]) =>
      xhr.setRequestHeader(key, value),
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        try {
          const payload = JSON.parse(xhr.responseText);
          reject(new ApiClientError(xhr.status, payload.error || "上传失败"));
        } catch {
          reject(new ApiClientError(xhr.status, "图片上传失败"));
        }
      }
    };
    xhr.onerror = () => reject(new ApiClientError(0, "网络错误，图片上传失败"));
    xhr.ontimeout = () => reject(new ApiClientError(0,"图片上传超时，可重试本张"));
    xhr.send(file);
  });
}
