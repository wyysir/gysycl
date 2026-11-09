import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const baseUrl = process.env.APP_URL || "http://localhost:3000";

async function json<T>(
  url: string,
  init: RequestInit = {},
  cookie = "",
): Promise<T> {
  const response = await fetch(`${baseUrl}${url}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(
      `${init.method || "GET"} ${url} → ${response.status}: ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`,
    );
  }
  return payload as T;
}

const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({ employeeNo: "admin", password: "admin123" }),
});
if (!loginResponse.ok) {
  throw new Error(`登录失败：${await loginResponse.text()}`);
}
const cookie = (loginResponse.headers.getSetCookie?.() || [])[0]?.split(";")[0];
if (!cookie) throw new Error("登录响应未返回 Cookie");

const svg = await fs.readFile(
  path.join(process.cwd(), "public", "sample-delivery.svg"),
);
const png = await sharp(svg).resize(1200).png().toBuffer();
const presign = await json<{
  objectKey: string;
  url: string;
  headers: Record<string, string>;
}>(
  "/api/uploads/presign",
  {
    method: "POST",
    body: JSON.stringify({
      mime: "image/png",
      fileName: "smoke-delivery.png",
      size: png.length,
    }),
  },
  cookie,
);
const uploadResponse = await fetch(`${baseUrl}${presign.url}`, {
  method: "PUT",
  headers: presign.headers,
  body: png,
});
if (!uploadResponse.ok) {
  throw new Error(`图片上传失败：${await uploadResponse.text()}`);
}

const created = await json<{ id: string }>(
  "/api/documents",
  {
    method: "POST",
    body: JSON.stringify({
      projectId: "prj_sh",
      docDate: "2026-10-19",
      pages: [
        {
          objectKey: presign.objectKey,
          mime: "image/png",
          fileName: "smoke-delivery.png",
        },
      ],
    }),
  },
  cookie,
);

let detail:
  | {
      document: {
        status: string;
        supplierId: string | null;
        items: Array<{
          rawName: string;
          name: string;
          ingredientId: string | null;
          matchStatus: string;
        }>;
        ocrError: string;
      };
    }
  | undefined;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const current = await json<NonNullable<typeof detail>>(
    `/api/documents/${created.id}`,
    {},
    cookie,
  );
  detail = current;
  if (current.document.status !== "PROCESSING") break;
}

if (!detail || detail.document.status === "PROCESSING") {
  throw new Error("OCR 任务超时");
}
const finalDetail = detail;
if (finalDetail.document.ocrError) {
  throw new Error(`OCR 失败：${finalDetail.document.ocrError}`);
}
if (finalDetail.document.items.length !== 2) {
  throw new Error(`预期 2 行明细，实际 ${finalDetail.document.items.length}`);
}
if (!finalDetail.document.items.some((item) => item.rawName === "青莱")) {
  throw new Error("演示识别未保留手写错字“青莱”");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      documentId: created.id,
      status: finalDetail.document.status,
      supplierId: finalDetail.document.supplierId,
      items: finalDetail.document.items.map((item) => ({
        rawName: item.rawName,
        canonicalName: item.name,
        matchStatus: item.matchStatus,
        ingredientId: item.ingredientId,
      })),
    },
    null,
    2,
  ),
);
