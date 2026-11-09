import { describe, expect, it, vi } from "vitest";

const { signatureUrl } = vi.hoisted(() => ({ signatureUrl: vi.fn(() => "https://example.test/signed") }));
vi.mock("ali-oss", () => ({ default: class { signatureUrl = signatureUrl; } }));
vi.mock("@/lib/config", () => ({ env: {}, isLocalStorage: false }));

import { createUploadTarget } from "@/server/storage";

describe("OSS browser upload CORS contract", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("signs bound batch uploads with only the allowed Content-Type header (%s)", async (mime) => {
    const key = "documents/batches/test/0-random.jpg";
    const target = await createUploadTarget(mime, "jpg", key);
    expect(target.objectKey).toBe(key);
    expect(target.headers).toEqual({ "Content-Type": mime });
    expect(signatureUrl).toHaveBeenLastCalledWith(key, {
      method: "PUT", expires: 600, "Content-Type": mime,
    });
  });
});
