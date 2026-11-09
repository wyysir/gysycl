import type { Prisma } from "@/generated/prisma/client";
import type { DocumentStatus } from "@/generated/prisma/enums";
import { ApiError } from "./errors";

// Claim the version before touching child rows. A losing transaction must not
// overwrite a new decision or produce duplicate audit records and notices.
export async function claimDocumentVersion(
  tx: Prisma.TransactionClient,
  document: { id: string; version: number; status: DocumentStatus },
) {
  const result = await tx.document.updateMany({
    where: { id: document.id, version: document.version, status: document.status },
    data: { version: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw new ApiError(409, "单据已被其他人修改或状态已变化，请刷新后重试");
  }
}
