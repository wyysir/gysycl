import type { CheckSeverity, Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/prisma";
import { dateOnly, normalizeName } from "@/lib/text";
import { thresholds } from "@/lib/config";
import { evaluateDocumentChecks, type CheckDraft } from "@/domain/checks";
import { ApiError } from "./errors";

function decimal(value: { toString(): string } | number | null | undefined): number {
  return Number(value ?? 0);
}

export async function recomputeDocumentChecks(
  db: Db,
  documentId: string,
): Promise<GraphCheck[]> {
  return db.$transaction((tx) => recomputeDocumentChecksInTransaction(tx, documentId));
}

export async function recomputeDocumentChecksInTransaction(
  db: Prisma.TransactionClient,
  documentId: string,
): Promise<GraphCheck[]> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { items: { orderBy: { lineNo: "asc" } }, pages: true },
  });
  if (!document) return [];
  // Approval closes these results. A delayed recheck must not reopen history.
  if (document.status === "APPROVED") {
    return db.checkResult.findMany({ where: { documentId } });
  }
  const locked = await db.document.updateMany({
    where: { id: documentId, version: document.version, status: document.status },
    data: { updatedAt: document.updatedAt },
  });
  if (locked.count !== 1) throw new ApiError(409, "单据已变化，请重新比对");

  const start = new Date(document.docDate);
  start.setUTCDate(start.getUTCDate() - 30);

  const [contracts, historicalItems] = await Promise.all([
    db.contract.findMany({
      where: {
        projectId: document.projectId,
        ...(document.supplierId ? { supplierId: document.supplierId } : {}),
      },
    }),
    db.documentItem.findMany({
      where: {
        document: {
          id: { not: document.id },
          status: "APPROVED",
          docDate: { gte: start, lt: document.docDate },
        },
      },
      include: {
        document: {
          select: {
            supplierId: true,
            projectId: true,
            docDate: true,
          },
        },
      },
    }),
  ]);

  const history = historicalItems
    .filter(
      (item) =>
        item.ingredientId &&
        item.document.supplierId === document.supplierId &&
        item.document.projectId === document.projectId,
    )
    .map((item) => ({
      ingredientId: item.ingredientId!,
      supplierId: item.document.supplierId!,
      projectId: item.document.projectId,
      spec: item.spec,
      unit: item.unit,
      quantity: decimal(item.quantity),
      unitPrice: decimal(item.unitPrice),
    }));

  const benchmark = historicalItems
    .filter((item) => item.ingredientId)
    .map((item) => ({
      ingredientId: item.ingredientId!,
      supplierId: item.document.supplierId || "",
      projectId: item.document.projectId,
      spec: item.spec,
      unit: item.unit,
      quantity: decimal(item.quantity),
      unitPrice: decimal(item.unitPrice),
    }));

  const drafts = evaluateDocumentChecks({
    document: {
      projectId: document.projectId,
      supplierId: document.supplierId,
      docDate: document.docDate,
      subtotal: decimal(document.subtotal),
      totalAmount: decimal(document.totalAmount),
    },
    items: document.items.map((item) => ({
      id: item.id,
      lineNo: item.lineNo,
      ingredientId: item.ingredientId,
      name: item.name,
      spec: item.spec,
      unit: item.unit,
      quantity: decimal(item.quantity),
      unitPrice: decimal(item.unitPrice),
      amount: decimal(item.amount),
      roundingAdjustment: item.roundingAdjustment,
      confidence: item.confidence,
      matchStatus: item.matchStatus,
    })),
    contracts: contracts.map((contract) => ({
      id: contract.id,
      projectId: contract.projectId,
      supplierId: contract.supplierId,
      ingredientId: contract.ingredientId,
      spec: contract.spec,
      unit: contract.unit,
      unitPrice: decimal(contract.unitPrice),
      startsOn: contract.startsOn,
      endsOn: contract.endsOn,
    })),
    history,
    benchmark,
    thresholds,
  });

  if (!document.supplierId) {
    drafts.unshift({
      dimension: "主数据匹配",
      type: "supplier_unmatched",
      severity: "ERROR",
      title: "供应商尚未确认",
      detail:
        document.ocrSupplierName
          ? `识别到“${document.ocrSupplierName}”，请选择已有供应商或确认新建。`
          : "请从供应商库选择，或确认后新建供应商。",
    });
  }

  const duplicateByIdentity = await findDuplicateDocument(db, document);
  if (duplicateByIdentity) {
    drafts.unshift({
      dimension: "重复校验",
      type: "duplicate_document",
      // 业务确认（2026-10-28）：同供应商同号跨日期也只提醒，允许提交和普通审核。
      severity: "WARNING",
      title: "发现疑似重复单据",
      detail: `与 ${duplicateByIdentity.project.name} 的 ${duplicateByIdentity.docNo || "无单号单据"} 相同或高度相似。`,
    });
  }

  const hashes = document.pages.map((page) => page.sha256).filter(Boolean);
  if (hashes.length) {
    const duplicatePages = await db.documentPage.findMany({
      where: {
        documentId: { not: document.id },
        sha256: { in: hashes },
      },
      include: {
        document: {
          include: { project: { select: { name: true } } },
        },
      },
    });
    if (duplicatePages.length) {
      drafts.unshift({
        dimension: "重复校验",
        type: "duplicate_image",
        severity: "ERROR",
        title: "原图已在其他单据中使用",
        detail: `相同图片已出现在 ${Array.from(new Map(duplicatePages.map(page => [page.documentId, `${page.document.project.name} · ${dateOnly(page.document.docDate)} · ${page.document.status} · ${page.document.docNo || "无单号"}`])).values()).join("、")}。重复使用原图可能造成重复记账，请移除误传图片、退回核对，或由有权限人员填写原因强制通过。`,
      });
    }
  }

  await db.checkResult.deleteMany({ where: { documentId: document.id } });
  if (drafts.length) {
    await db.checkResult.createMany({
      data: drafts.map((draft) => ({
        documentId: document.id,
        itemId: draft.itemId || null,
        dimension: draft.dimension,
        type: draft.type,
        severity: draft.severity as CheckSeverity,
        title: draft.title,
        detail: draft.detail,
        expectedValue:
          draft.expectedValue === undefined ? null : draft.expectedValue,
        actualValue:
          draft.actualValue === undefined ? null : draft.actualValue,
      })),
    });
  }

  return db.checkResult.findMany({
    where: { documentId: document.id },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
  });
}

async function findDuplicateDocument(
  db: Db | Prisma.TransactionClient,
  document: Prisma.DocumentGetPayload<{
    include: { pages: true; items: true };
  }>,
) {
  if (!document.docNo || !document.supplierId) return null;
  return db.document.findFirst({
    where: {
      id: { not: document.id },
      docNo: document.docNo,
      supplierId: document.supplierId,
    },
    include: { project: { select: { name: true } } },
  });
}

export type GraphCheck = Prisma.CheckResultGetPayload<object>;
