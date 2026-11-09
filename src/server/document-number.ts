import { randomUUID } from "node:crypto";

// Generated once on creation; the UUID suffix avoids concurrent timestamp collisions.
export function generateDocumentNumber() {
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).replaceAll("-", "");
  return `SHD-${date}-${randomUUID().replaceAll("-", "").toUpperCase()}`;
}
