import { readRoundingAdjustment, validRounding } from "@/domain/rounding";
import crypto from "node:crypto";
import { generateDocumentNumber } from "./document-number";
import type { Prisma } from "@/generated/prisma/client";
import { ApiError } from "./errors";
import { logContext, recordError } from "./observability/logger";
import { getReadyDb } from "@/lib/bootstrap";
import { dateOnly, normalizeName, normalizeUnit } from "@/lib/text";
import { createIngredientMatcher, bestSupplierMatch } from "./master-data";
import { extractDocuments, preprocessImage, type PreprocessedImage } from "./ocr";
import { recomputeDocumentChecksInTransaction } from "./checks";
import { claimDocumentVersion } from "./document-lock";
import {
  deleteObject,
  objectExists,
  objectKeyFromPage,
  readObject,
  writeLocalObject,
} from "./storage";
import { isLocalStorage } from "@/lib/config";

export type UploadedPage = {
  objectKey: string;
  mime: string;
  fileName: string;
};

export async function createManualDocument(input: {
  userId: string;
  projectId: string;
  docDate: Date;
}) {
  const db = await getReadyDb();
  return db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: { docNo: generateDocumentNumber(), projectId: input.projectId, docDate: input.docDate, createdById: input.userId, status: "DRAFT" },
    });
    await tx.auditLog.create({
      data: {
        entityType: "document", entityId: document.id, documentId: document.id,
        userId: input.userId, action: "document.created",
        afterValue: { projectId: input.projectId, pageCount: 0, entryMode: "MANUAL" },
      },
    });
    return document;
  });
}

export async function createDocument(input: {
  userId: string;
  projectId: string;
  docDate: Date;
  pages: UploadedPage[];
}) {
  const db = await getReadyDb();
  if (!input.pages.length || input.pages.length > 5) {
    throw new ApiError(400, "单据必须包含 1–5 页图片");
  }
  // 先完成所有图片的存在性校验、读取与摘要计算，再创建单据，避免留下半成品记录。
  const pages = await Promise.all(
    input.pages.map(async (page, index) => {
      if (!(await objectExists(page.objectKey))) {
        throw new ApiError(400, `图片 ${page.fileName} 尚未上传完成，请重新上传`);
      }
      try {
        const buffer = await readObject(page.objectKey);
        return {
          pageNo: index + 1,
          objectKey: page.objectKey,
          mime: page.mime,
          fileName: page.fileName,
          sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        };
      } catch {
        throw new ApiError(400, `图片 ${page.fileName} 读取失败，请重新上传`);
      }
    }),
  );
  const document = await db.document.create({
    data: {
      projectId: input.projectId,
      docNo: generateDocumentNumber(),
      docDate: input.docDate,
      status: "PROCESSING",
      createdById: input.userId,
      pages: { create: pages },
    },
  });
  await db.auditLog.create({
    data: {
      entityType: "document",
      entityId: document.id,
      documentId: document.id,
      userId: input.userId,
      action: "document.created",
      afterValue: {
        projectId: input.projectId,
        pageCount: input.pages.length,
      },
    },
  });
  return document;
}

export async function processDocumentOcr(documentId: string, expectedVersion?: number) {
  const startedAt = performance.now();
  const db = await getReadyDb();
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { pages: { orderBy: { pageNo: "asc" } }, items: true },
  });
  if (!document) throw new ApiError(404, "单据不存在或已删除");
  if (expectedVersion !== undefined && document.version !== expectedVersion) throw new ApiError(409, "本次识别任务已处理或单据已修改");
  if (!document.pages.length) throw new Error("单据没有图片");
  // 待审核/已通过单据不能被 OCR 任务覆盖，防止队列重试绕过“已通过不可编辑”约束。
  if (!["PROCESSING", "DRAFT", "NEEDS_REVISION"].includes(document.status)) {
    throw new ApiError(409, "单据当前状态不允许重新识别");
  }

  const processingDocument = await db.$transaction(async (tx) => {
    await claimDocumentVersion(tx, document);
    return tx.document.update({
      where: { id: document.id },
      data: { status: "PROCESSING", ocrError: "" },
    });
  });
  try {
    const rawImages: Buffer[] = [];
    const preparedImages: Array<PreprocessedImage | undefined> = [];
    for (const page of document.pages) {
      await db.documentPage.update({
        where: { id: page.id },
        data: { status: "PROCESSING", error: "" },
      });
      const raw = await readObject(page.objectKey);
      rawImages.push(raw);
      preparedImages.push(undefined);
      try {
        const processed = await preprocessImage(raw);
        preparedImages[preparedImages.length - 1] = processed;
        const processedKey = page.objectKey.replace(/\.[^.]+$/, "-processed.jpg");
        if (isLocalStorage) {
          await writeLocalObject(processedKey, processed.buffer);
        }
        await db.documentPage.update({
          where: { id: page.id },
          data: {
            processedObjectKey: isLocalStorage ? processedKey : page.processedObjectKey,
            width: processed.width,
            height: processed.height,
          },
        });
      } catch (error) {
        await db.documentPage.update({
          where: { id: page.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    const preprocessingMs = Math.round(performance.now() - startedAt);
    const recognitionStart = performance.now();
    const extracted = await extractDocuments(rawImages, preparedImages);
    const recognitionMs = Math.round(performance.now() - recognitionStart);
    const matchingStart = performance.now();
    if (!extracted.items.length) {
      const message = `未识别出任何明细：${extracted.warnings.join("；") || "请核对图片是否清晰，或继续人工录入"}`;
      if (extracted.raw.vlmFailed) throw new Error(message);
      throw new ApiError(422, message);
    }
    const supplierMatch = extracted.supplierName
      ? await bestSupplierMatch(db, extracted.supplierName)
      : null;
    const exactSupplier =
      supplierMatch?.exact || (supplierMatch?.score || 0) >= 0.98
        ? supplierMatch
        : null;
    const ingredientMatcher = await createIngredientMatcher(db);
    const items = await Promise.all(
      extracted.items.map(async (item) => {
        const candidates = ingredientMatcher(item.rawName, document.batchId ? 10 : 1);
        const match = (document.batchId ? candidates.find(candidate=>normalizeUnit(candidate.unit)===normalizeUnit(item.unit)) : undefined) || candidates[0] || null;
        const exact = !!match && (match.exact || match.score >= 0.98) && (!document.batchId || !!item.unit && normalizeUnit(match.unit)===normalizeUnit(item.unit));
        const unit = normalizeUnit(item.unit || (!document.batchId && exact ? match?.unit || "" : ""));
        // 用户确认：识别后的规格按单位填写，不回填主数据中的数量或旧规格。
        const spec = unit;
        return {
          lineNo: item.lineNo,
          rawName: item.rawName,
          name: exact ? match!.name : item.rawName,
          spec,
          unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
          confidence: item.confidence,
          ingredientId: exact ? match!.id : null,
          matchStatus: exact ? ("MATCHED" as const) : ("SIMILAR" as const),
          matchScore: match?.score ?? null,
          rawOcr: {
            ...item.rawOcr,
            suggestions: match ? [match] : [],
          } as Prisma.InputJsonValue,
        };
      }),
    );
    const matchingMs = Math.round(performance.now() - matchingStart);
    const persistenceStart = performance.now();
    const subtotal = extracted.subtotal;
    const totalAmount = extracted.totalAmount;

    await db.$transaction(async (tx) => {
      await claimDocumentVersion(tx, processingDocument);
      await tx.documentItem.deleteMany({ where: { documentId: document.id } });
      if (items.length) {
        await tx.documentItem.createMany({
          data: items.map((item) => ({ ...item, documentId: document.id })),
        });
      }
      await tx.document.update({
        where: { id: document.id },
        data: {
          docDate: extracted.docDate || document.docDate,
          supplierId: exactSupplier?.id || document.supplierId,
          ocrSupplierName: extracted.supplierName,
          supplierMatchStatus: exactSupplier
            ? "MATCHED"
            : extracted.supplierName
              ? "SIMILAR"
              : "UNMATCHED",
          supplierMatchScore: supplierMatch?.score ?? null,
          subtotal,
          totalAmount,
          status: "DRAFT",
          ocrError: "",
        },
      });
      const pageSources = Array.isArray(extracted.raw.pages) ? extracted.raw.pages : [];
      for (const page of document.pages) {
        const source = pageSources.find(value => value && typeof value === "object"
          && (value as {pageNo?: number}).pageNo === page.pageNo) as {
            sourceDocNo?: string; sourceDocDate?: string;
          } | undefined;
        await tx.documentPage.update({where: {id: page.id}, data: {
          status: "COMPLETED", error: "",
          ocrRaw: {
            sourceDocNo: source?.sourceDocNo || (document.pages.length === 1 ? extracted.docNo : ""),
            sourceDocDate: source?.sourceDocDate || (document.pages.length === 1 && extracted.docDate ? dateOnly(extracted.docDate) : ""),
          },
        }});
      }
      await tx.auditLog.create({
        data: {
          entityType: "document",
          entityId: document.id,
          documentId: document.id,
          action: "ocr.completed",
          afterValue: {
            provider: extracted.provider,
            timings: { preprocessingMs, recognitionMs, matchingMs },
            itemCount: items.length,
            warnings: extracted.warnings,
            pages: Array.isArray(extracted.raw.pages)
              ? extracted.raw.pages.map(page => {
                  const value = page as { pageNo: number; itemCount: number; sourceDocNo: string; sourceDocDate: string; sourceTotal: unknown };
                  return {
                    pageNo: value.pageNo, itemCount: value.itemCount,
                    sourceDocNo: value.sourceDocNo, sourceDocDate: value.sourceDocDate,
                    sourceTotal: typeof value.sourceTotal === "number" ? value.sourceTotal : null,
                  };
                })
              : [{
                  pageNo: 1, itemCount: items.length,
                  sourceDocNo: extracted.docNo, sourceDocDate: extracted.docDate ? dateOnly(extracted.docDate) : "",
                  sourceTotal: extracted.totalAmount,
                }],
          },
        },
      });
      await recomputeDocumentChecksInTransaction(tx, document.id);
    });
    console.info("ocr.timings", JSON.stringify({ documentId, pages: rawImages.length, preprocessingMs, recognitionMs, matchingMs, persistenceMs: Math.round(performance.now() - persistenceStart), totalMs: Math.round(performance.now() - startedAt) }));
    return { extracted, itemCount: items.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.$transaction(async (tx) => {
      const result = await tx.document.updateMany({
        where: { id: document.id, version: processingDocument.version, status: "PROCESSING" },
        data: { status: "DRAFT", ocrError: message, version: { increment: 1 } },
      });
      // A late job failure must never reset a newer save or approval.
      if (result.count !== 1) return;
      await tx.documentPage.updateMany({
        where: { documentId: document.id },
        data: { status: "FAILED", error: message },
      });
      await tx.auditLog.create({
        data: {
          entityType: "document", entityId: document.id, documentId: document.id,
          action: "ocr.failed", afterValue: { error: message },
        },
      });
    });
    throw error;
  }
}

let queueInstance: import("bullmq").Queue | null = null;

export async function enqueueOcr(documentId: string, requestedVersion?: number) {
  const { env } = await import("@/lib/config");
  const db = await getReadyDb();
  const document = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  const expectedVersion = requestedVersion ?? document.version;
  if (document.version !== expectedVersion) return "already-handled";
  if (!env.REDIS_URL) {
    setTimeout(() => {
      processDocumentOcr(documentId, expectedVersion).catch((error) => {
        recordError("ocr.inline_failed", error, { document_id: documentId });
      });
    }, 10);
    return "inline";
  }
  if (!queueInstance) {
    const { Queue } = await import("bullmq");
    queueInstance = new Queue("ocr", {
      connection: { url: env.REDIS_URL },
    });
  }
  await queueInstance.add(
    "extract",
    { documentId, expectedVersion, traceRequestId: logContext()?.requestId },
    {
      jobId: `document-${documentId}-v${expectedVersion}`,
      // A timeout may still be billable. Let the user explicitly retry instead
      // of silently repeating paid inference, including previously read pages.
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
  return "queued";
}

export async function documentImageUrl(page: {
  objectKey: string;
  processedObjectKey: string | null;
}) {
  if (page.objectKey.startsWith("demo/")) return "/sample-delivery.svg";
  return `/api/files?key=${encodeURIComponent(objectKeyFromPage(page))}`;
}

export async function deleteDocumentObjects(documentId: string) {
  const db = await getReadyDb();
  const pages = await db.documentPage.findMany({ where: { documentId } });
  await Promise.all(
    pages.flatMap((page) =>
      [page.objectKey, page.processedObjectKey]
        .filter((key): key is string => Boolean(key))
        .map((key) => deleteObject(key)),
    ),
  );
}

export function documentDto(
  document: Prisma.DocumentGetPayload<{
    include: {
      project: true;
      supplier: true;
      pages: true;
      items: true;
      checks: true;
    };
  }>,
) {
  return {
    batchId: document.batchId,
    batchPosition: document.batchPosition,
    checkedVersion: document.checkedVersion,
    checkedAt: document.checkedAt?.toISOString() || null,
    id: document.id,
    docNo: document.docNo,
    docDate: dateOnly(document.docDate),
    projectId: document.projectId,
    projectName: document.project.name,
    supplierId: document.supplierId,
    supplierName: document.supplier?.name || document.ocrSupplierName,
    ocrSupplierName: document.ocrSupplierName,
    supplierMatchStatus: document.supplierMatchStatus,
    supplierMatchScore: document.supplierMatchScore,
    status: document.status,
    subtotal: Number(document.subtotal),
    taxAmount: Number(document.taxAmount),
    totalAmount: Number(document.totalAmount),
    notes: document.notes,
    reviewNote: document.reviewNote,
    overrideReason: document.overrideReason,
    version: document.version,
    ocrError: document.ocrError,
    createdById: document.createdById,
    submittedAt: document.submittedAt?.toISOString() || null,
    reviewedAt: document.reviewedAt?.toISOString() || null,
    createdAt: document.createdAt.toISOString(),
    items: document.items
      .sort((left, right) => left.lineNo - right.lineNo)
      .map((item) => ({
        id: item.id,
        lineNo: item.lineNo,
        rawName: item.rawName,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount),
        roundingAdjustment: readRoundingAdjustment(item.roundingAdjustment),
        roundingConfirmed: validRounding({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), amount: Number(item.amount) }, item.roundingAdjustment),
        confidence: item.confidence,
        sourcePageNo: item.rawOcr && typeof item.rawOcr === "object" && !Array.isArray(item.rawOcr)
          && typeof item.rawOcr.pageNo === "number" ? item.rawOcr.pageNo : null,
        ingredientId: item.ingredientId,
        matchStatus: item.matchStatus,
        matchScore: item.matchScore,
      })),
    pages: document.pages.map((page) => ({
      id: page.id,
      pageNo: page.pageNo,
      fileName: page.fileName,
      url:
        page.objectKey.startsWith("demo/")
          ? "/sample-delivery.svg"
          : `/api/files?key=${encodeURIComponent(
              page.processedObjectKey || page.objectKey,
            )}`,
      status: page.status,
      width: page.width,
      height: page.height,
      sourceDocNo: page.ocrRaw && typeof page.ocrRaw === "object" && !Array.isArray(page.ocrRaw)
        && typeof page.ocrRaw.sourceDocNo === "string" ? page.ocrRaw.sourceDocNo : "",
      sourceDocDate: page.ocrRaw && typeof page.ocrRaw === "object" && !Array.isArray(page.ocrRaw)
        && typeof page.ocrRaw.sourceDocDate === "string" ? page.ocrRaw.sourceDocDate : "",
    })),
    checks: document.checks.map((check) => ({
      id: check.id,
      itemId: check.itemId,
      dimension: check.dimension,
      type: check.type,
      severity: check.severity,
      status: check.status,
      title: check.title,
      detail: check.detail,
      expectedValue:
        check.expectedValue === null ? null : Number(check.expectedValue),
      actualValue:
        check.actualValue === null ? null : Number(check.actualValue),
    })),
  };
}

export type DocumentDto = ReturnType<typeof documentDto>;

export function itemInputSignature(
  items: Array<{
    lineNo: number;
    name: string;
    spec: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>,
) {
  return items
    .map(
      (item) =>
        `${item.lineNo}:${normalizeName(item.name)}:${normalizeName(
          item.spec,
        )}:${normalizeUnit(item.unit)}:${item.quantity}:${item.unitPrice}:${item.amount}`,
    )
    .join("|");
}
