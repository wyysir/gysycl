import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";
import { env, isLocalStorage } from "@/lib/config";

const uploadRoot = path.resolve(process.cwd(), ".data", "uploads");
const allowedMime = new Set(["image/jpeg", "image/png", "image/webp"]);

function signingValue(key: string, mime: string, expiresAt: number) {
  return crypto
    .createHmac("sha256", env.SESSION_SECRET)
    .update(`${key}\n${mime}\n${expiresAt}`)
    .digest("base64url");
}

export function uploadToken(key: string, mime: string, expiresAt: number) {
  return signingValue(key, mime, expiresAt);
}

export function verifyUploadToken(
  key: string,
  mime: string,
  expiresAt: number,
  token: string,
) {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = Buffer.from(signingValue(key, mime, expiresAt));
  const supplied = Buffer.from(token);
  if (expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(expected, supplied);
}

function getOssClient() {
  return new OSS({
    region: env.OSS_REGION,
    bucket: env.OSS_BUCKET,
    endpoint: env.OSS_ENDPOINT || undefined,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    secure: true,
  });
}

function safeLocalPath(key: string) {
  const resolved = path.resolve(uploadRoot, key);
  if (!resolved.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("非法对象路径");
  }
  return resolved;
}

export type UploadTarget = {
  objectKey: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
};

export async function createUploadTarget(
  mime: string,
  suffix = "jpg",
  boundKey?: string,
): Promise<UploadTarget> {
  if (!allowedMime.has(mime)) throw new Error("不支持的图片格式");
  const now = new Date();
  const objectKey = boundKey || `documents/${now.getUTCFullYear()}/${String(
    now.getUTCMonth() + 1,
  ).padStart(2, "0")}/${crypto.randomUUID()}.${suffix}`;
  const expiresAt = Date.now() + 10 * 60 * 1000;
  if (isLocalStorage) {
    const token = uploadToken(objectKey, mime, expiresAt);
    const params = new URLSearchParams({
      key: objectKey,
      mime,
      expiresAt: String(expiresAt),
      token,
    });
    return {
      objectKey,
      method: "PUT",
      url: `/api/uploads/local?${params.toString()}`,
      headers: { "Content-Type": mime },
      expiresAt,
    };
  }
  const client = getOssClient();
  return {
    objectKey,
    method: "PUT",
    url: client.signatureUrl(objectKey, {
      method: "PUT",
      expires: 600,
      "Content-Type": mime,
    }),
    // Browser signatures only address temporary objects; completion freezes a
    // separate server-owned original. Keep headers within the bucket CORS policy.
    headers: { "Content-Type": mime },
    expiresAt,
  };
}

export async function writeLocalObject(
  key: string,
  buffer: Buffer,
  exclusive = false,
): Promise<void> {
  const filePath = safeLocalPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer, exclusive ? { flag: "wx" } : undefined);
}

/** Server-owned originals are never the target of a browser upload signature. */
export async function writePrivateOriginal(key: string, buffer: Buffer, mime: string): Promise<void> {
  if (isLocalStorage) return writeLocalObject(key, buffer, true);
  await getOssClient().put(key, buffer, { mime });
}

export async function objectExists(key: string): Promise<boolean> {
  if (key.startsWith("demo/")) return true;
  if (isLocalStorage) {
    try {
      const stat = await fs.stat(safeLocalPath(key));
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }
  try {
    await getOssClient().head(key);
    return true;
  } catch {
    return false;
  }
}

export async function readObject(key: string): Promise<Buffer> {
  if (key.startsWith("demo/")) {
    const publicPath = path.resolve(
      process.cwd(),
      "public",
      key.replace(/^demo\//, ""),
    );
    return fs.readFile(publicPath);
  }
  if (isLocalStorage) {
    return fs.readFile(safeLocalPath(key));
  }
  const response = await fetch(getOssClient().signatureUrl(key, { expires: 300 }));
  if (!response.ok) throw new Error(`读取 OSS 原图失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  if (key.startsWith("demo/")) return;
  if (isLocalStorage) {
    await fs.rm(safeLocalPath(key), { force: true });
    return;
  }
  await getOssClient().delete(key);
}

export function sniffImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function objectKeyFromPage(page: {
  processedObjectKey: string | null;
  objectKey: string;
}) {
  return page.processedObjectKey || page.objectKey;
}
