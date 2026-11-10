import { canDeleteRecord } from "@/lib/permissions";
import type { Prisma } from "@/generated/prisma/client";
import { getReadyDb } from "@/lib/bootstrap";
import { roundMoney } from "@/lib/text";
import { canAccessDocument, canEditDocument, type SessionUser } from "./auth";
import { ApiError } from "./errors";
import { claimDocumentVersion } from "./document-lock";
import { recomputeDocumentChecks, recomputeDocumentChecksInTransaction } from "./checks";
import { deleteObject } from "./storage";
import { recordError } from "./observability/logger";

const include = {
  pages: { orderBy: { pageNo: "asc" as const } },
  items: { orderBy: { lineNo: "asc" as const } },
  approvals: true,
} satisfies Prisma.DocumentInclude;
type Draft = Prisma.DocumentGetPayload<{include: typeof include}>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

async function draftForDeletion(user: SessionUser, id: string, version: number): Promise<Draft> {
  const db = await getReadyDb();
  const draft = await db.document.findUnique({where: {id}, include});
  if (!draft) throw new ApiError(404, "单据不存在或已删除");
  if (!canAccessDocument(user, draft) || !canDeleteRecord(user, draft)) {
    throw new ApiError(403, "无权删除该单据或图片");
  }
  if (!["DRAFT", "NEEDS_REVISION"].includes(draft.status)) throw new ApiError(409, "仅草稿或退回修改单据允许删除，识别中、待审核或已通过单据不能删除");
  if (draft.version !== version) throw new ApiError(409, "单据已变化，请刷新后再删除");
  return draft;
}

async function relatedDocuments(draft: Draft, hashes: string[]) {
  const db = await getReadyDb();
  const matches = await db.document.findMany({
    where: {
      id: {not: draft.id},
      status: {in: ["DRAFT", "NEEDS_REVISION", "PENDING_REVIEW"]},
      OR: [
        {pages: {some: {sha256: {in: hashes}}}},
        ...(draft.supplierId && draft.docNo ? [{supplierId: draft.supplierId, docNo: draft.docNo}] : []),
      ],
    },
    select: {id: true},
    orderBy: {id: "asc"},
  });
  return matches.map(match => match.id);
}

async function finishDeletion(user: SessionUser, entityId: string, keys: string[], related: string[]) {
  const db = await getReadyDb();
  const warnings: string[] = [];
  for (const key of new Set(keys)) {
    // Content-identical uploads have different keys. Conversely, one key can
    // be referenced by more than one record: check both original/processed uses.
    try {
      if (await db.documentPage.count({where: {OR: [{objectKey: key}, {processedObjectKey: key}]}})) continue;
      await deleteObject(key);
    } catch (error) {
      recordError("storage.cleanup_failed", error, { document_id: entityId });
      warnings.push("有图片文件暂未清理，记录已删除，请联系管理员检查存储");
      try {
        await db.auditLog.create({data: {
          entityType: "document", entityId, userId: user.id,
          action: "storage.cleanup_failed", afterValue: {objectKey: key},
        }});
      } catch (error) {
        recordError("storage.cleanup_audit_failed", error, { document_id: entityId });
      }
    }
  }
  // Recheck after committing the deletion so no stale duplicate-image error
  // blocks a surviving draft. Approved historical checks are never reopened.
  for (const id of related) {
    try {
      await recomputeDocumentChecks(db, id);
    } catch (error) {
      recordError("document.delete_recheck_failed", error, { document_id: id });
      warnings.push("关联单据提醒未刷新，请打开保留的单据点重新比对");
    }
  }
  return [...new Set(warnings)];
}

export async function deleteDraft(user: SessionUser, id: string, version: number) {
  const db = await getReadyDb();
  const draft = await draftForDeletion(user, id, version);
  const related = await relatedDocuments(draft, draft.pages.map(page => page.sha256));
  const keys = draft.pages.flatMap(page => [page.objectKey, page.processedObjectKey].filter((key): key is string => Boolean(key)));
  await db.$transaction(async tx => {
    await claimDocumentVersion(tx, draft);
    // Keep audit history after hard deletion; this is not a recoverable draft.
    await tx.auditLog.updateMany({where: {documentId: id}, data: {documentId: null}});
    await tx.auditLog.create({data: {
      entityType: "document", entityId: id, userId: user.id, action: "document.deleted",
      beforeValue: {
        status: draft.status, version: draft.version, docNo: draft.docNo,
        projectId: draft.projectId, pageCount: draft.pages.length, itemCount: draft.items.length,
        approvals: draft.approvals.map(approval => ({
          action: approval.action, reviewerId: approval.reviewerId, note: approval.note,
          createdAt: approval.createdAt.toISOString(),
          beforeValue: approval.beforeValue, afterValue: approval.afterValue,
        })),
      },
    }});
    await tx.document.delete({where: {id}});
  });
  return {deleted: true, warnings: await finishDeletion(user, id, keys, related)};
}

export async function deleteDraftPage(user: SessionUser, id: string, pageId: string, version: number) {
  const db = await getReadyDb();
  const draft = await draftForDeletion(user, id, version);
  const target = draft.pages.find(page => page.id === pageId);
  if (!target) throw new ApiError(404, "图片不存在或不属于该单据");
  // No empty shells: deleting the final image is confirmed as whole-draft deletion.
  if (draft.pages.length === 1) return deleteDraft(user, id, version);
  const remainingPages = draft.pages.filter(page => page.id !== pageId);
  const removedItems = draft.items.filter(item => object(item.rawOcr).pageNo === target.pageNo);
  const removedIds = new Set(removedItems.map(item => item.id));
  const remainingItems = draft.items.filter(item => !removedIds.has(item.id));
  const pageNumbers = new Map(remainingPages.map((page, index) => [page.pageNo, index + 1]));
  const unknownRows = remainingItems.filter(item => !pageNumbers.has(Number(object(item.rawOcr).pageNo))).length;
  const related = await relatedDocuments(draft, [target.sha256]);
  const previousOcr = await db.auditLog.findFirst({
    where: {documentId: id, action: {in: ["ocr.completed", "document.page_deleted"]}},
    orderBy: {createdAt: "desc"}, select: {afterValue: true},
  });
  const oldPages = object(previousOcr?.afterValue).pages;
  const sourcePages = Array.isArray(oldPages) ? oldPages.map(object) : [];
  const metadata = remainingPages.map(page => {
    const own = object(page.ocrRaw);
    const source = Object.keys(own).length ? own : sourcePages.find(source => source.pageNo === page.pageNo) || {};
    return {
      sourceDocNo: typeof source.sourceDocNo === "string" ? source.sourceDocNo : "",
      sourceDocDate: typeof source.sourceDocDate === "string" ? source.sourceDocDate : "",
    };
  });
  const notices = [
    `已删除第 ${target.pageNo} 页及其 ${removedItems.length} 条来源明细，请核对剩余明细并重新填写整单总价`,
    ...(unknownRows ? ["部分旧明细没有来源页，已保留，请人工移除误传图片对应的明细"] : []),
  ];
  await db.$transaction(async tx => {
    await claimDocumentVersion(tx, draft);
    await tx.documentPage.delete({where: {id: pageId}});
    await tx.documentItem.deleteMany({where: {documentId: id, id: {in: [...removedIds]}}});
    // Ascending old order only moves numbers down, avoiding unique-index collisions.
    for (const [index, page] of remainingPages.entries()) {
      await tx.documentPage.update({where: {id: page.id}, data: {pageNo: index + 1, ocrRaw: metadata[index]}});
    }
    for (const [index, item] of remainingItems.entries()) {
      const raw = object(item.rawOcr);
      const pageNo = pageNumbers.get(Number(raw.pageNo));
      await tx.documentItem.update({where: {id: item.id}, data: {
        lineNo: index + 1,
        ...(pageNo ? {rawOcr: {...raw, pageNo} as Prisma.InputJsonValue} : {}),
      }});
    }
    await tx.document.update({where: {id}, data: {
      subtotal: roundMoney(remainingItems.reduce((sum, item) => sum + Number(item.amount), 0)),
      totalAmount: 0,
      ocrError: remainingItems.length ? "" : "图片已调整，请重新识别或人工录入剩余明细",
    }});
    await tx.auditLog.create({data: {
      entityType: "document", entityId: id, documentId: id, userId: user.id,
      action: "document.page_deleted",
      beforeValue: {pageId, pageNo: target.pageNo, fileName: target.fileName, removedItemCount: removedItems.length},
      afterValue: {
        warnings: notices,
        pages: remainingPages.map((page, index) => ({pageNo: index + 1, ...metadata[index]})),
      },
    }});
    await recomputeDocumentChecksInTransaction(tx, id);
  });
  const keys = [target.objectKey, target.processedObjectKey].filter((key): key is string => Boolean(key));
  return {deleted: false, removedItemCount: removedItems.length, warnings: [...notices, ...await finishDeletion(user, id, keys, related)]};
}
