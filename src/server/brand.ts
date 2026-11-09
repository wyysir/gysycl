import crypto from "node:crypto";
import sharp from "sharp";
import { getReadyDb } from "@/lib/bootstrap";
import type { BrandInfo } from "@/lib/client/brand";
import { emptyBrand } from "@/lib/client/brand";
import type { SessionUser } from "@/server/auth";
import { ApiError } from "@/server/errors";
import { sniffImageMime } from "@/server/storage";

const key = "company.brand";
export const maxLogoBytes = 2 * 1024 * 1024;
type StoredBrand = { version: number; mime?: string; data?: string; width?: number; height?: number; viewBox?: string; sha256?: string };
function stored(value: unknown): StoredBrand {
  return value && typeof value === "object" ? value as StoredBrand : { version: 0 };
}
function dto(value: StoredBrand): BrandInfo {
  return {
    ...emptyBrand, version: value.version || 0,
    ...(value.data ? { logoUrl: `/api/brand/logo?v=${value.version}`, width: value.width || 1, height: value.height || 1, viewBox: value.viewBox || `0 0 ${value.width || 1} ${value.height || 1}` } : {}),
  };
}
export async function getBrand(): Promise<BrandInfo> {
  const db = await getReadyDb();
  return dto(stored((await db.systemSetting.findUnique({ where: { key } }))?.value));
}
export async function getBrandImage() {
  const db = await getReadyDb();
  const value = stored((await db.systemSetting.findUnique({ where: { key } }))?.value);
  return value.data && value.mime ? { bytes: Buffer.from(value.data, "base64"), mime: value.mime, sha256: value.sha256 } : null;
}

// Only measure the visible bounds. Stored image bytes remain identical to the upload.
export async function inspectLogo(bytes: Buffer) {
  if (!bytes.length || bytes.length > maxLogoBytes) throw new ApiError(413, "Logo不能为空，且不能超过2MB");
  const mime = sniffImageMime(bytes);
  if (!mime) throw new ApiError(400, "请选择PNG、JPG或WebP图片");
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 16_000_000 }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i + 3] > 32 && Math.min(data[i], data[i + 1], data[i + 2]) < 235) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left) throw new ApiError(400, "图片中没有可见的Logo，请重新选择");
    const pad = Math.ceil(Math.max(right - left, bottom - top) * 0.04);
    left = Math.max(0, left - pad); top = Math.max(0, top - pad);
    right = Math.min(info.width - 1, right + pad); bottom = Math.min(info.height - 1, bottom + pad);
    return { mime, width: info.width, height: info.height, viewBox: `${left} ${top} ${right - left + 1} ${bottom - top + 1}` };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "图片无法读取或像素过大，请使用1600万像素以内的有效图片");
  }
}

export async function saveBrand(user: SessionUser, bytes: Buffer | null, version: number) {
  if (user.globalRole !== "ADMIN") throw new ApiError(403, "只有管理员可以修改企业Logo");
  if (!Number.isSafeInteger(version) || version < 0) throw new ApiError(400, "Logo版本无效，请刷新后重试");
  const image = bytes ? await inspectLogo(bytes) : null;
  const db = await getReadyDb();
  try {
    return await db.$transaction(async tx => {
      const current = await tx.systemSetting.findUnique({ where: { key } });
      const before = stored(current?.value);
      if ((before.version || 0) !== version) throw new ApiError(409, "企业Logo已被修改，请刷新预览后重试");
      const next: StoredBrand = { version: version + 1, ...(image && bytes ? { ...image, data: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") } : {}) };
      if (current) {
        const changed = await tx.systemSetting.updateMany({ where: { key, value: { path: ["version"], equals: version } }, data: { value: next } });
        if (changed.count !== 1) throw new ApiError(409, "企业Logo已被修改，请刷新后重试");
      } else await tx.systemSetting.create({ data: { key, value: next } });
      await tx.auditLog.create({ data: { entityType: "brand", entityId: key, userId: user.id, action: bytes ? "brand.logo_uploaded" : "brand.logo_removed", beforeValue: { version, sha256: before.sha256 || null }, afterValue: { version: next.version, sha256: next.sha256 || null } } });
      return dto(next);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new ApiError(409, "企业Logo已被修改，请刷新后重试");
    throw error;
  }
}
