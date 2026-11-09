import { canSubmitRecord, documentVisibility, hasPermission } from "@/lib/permissions";
import { canConfirmRounding, validRounding, type RoundingItem } from "@/domain/rounding";
import { Prisma } from "@/generated/prisma/client";
import { DocumentStatus } from "@/generated/prisma/enums";
import { getReadyDb } from "@/lib/bootstrap";
import { dateOnly, normalizeUnit, parseDateOnly, roundMoney } from "@/lib/text";
import {
  allowedProjectIds,
  ApiError,
  canAccessDocument,
  canEditDocument,
  canReviewDocument,
  canSubmitProject,
  canSuperviseProject,
  isAdmin,
  type SessionUser,
} from "./auth";
import { recomputeDocumentChecks, recomputeDocumentChecksInTransaction } from "./checks";
import { documentDto } from "./documents";
import { documentReadScope, visibleDocument, canViewCheckDetails } from "./read-scope";
import { claimDocumentVersion } from "./document-lock";

const detailInclude = {
  project: true,
  supplier: true,
  pages: { orderBy: { pageNo: "asc" as const } },
  items: { orderBy: { lineNo: "asc" as const } },
  checks: {
    orderBy: [{ severity: "asc" as const }, { createdAt: "asc" as const }],
  },
} satisfies Prisma.DocumentInclude;

export async function listDocuments(
  user: SessionUser,
  filters: {
    q?: string;
    status?: string;
    from?: string;
    to?: string;
    projectId?: string;
    supplierId?: string;
    limit?: number;
  },
) {
  const db = await getReadyDb();
  const projectIds = allowedProjectIds(user);
  const where: Prisma.DocumentWhereInput = {AND:[documentReadScope(user)]};
  if (projectIds) where.projectId = { in: projectIds };
  if (filters.projectId) {
    if (projectIds && !projectIds.includes(filters.projectId)) {
      throw new ApiError(403, "无权查看该项目点");
    }
    where.projectId = filters.projectId;
  }
  if (filters.status) {
    if (
      !Object.values(DocumentStatus).includes(filters.status as DocumentStatus)
    ) {
      throw new ApiError(400, "单据状态无效");
    }
    where.status = filters.status as DocumentStatus;
  }
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.from || filters.to) {
    const from = filters.from ? parseDateOnly(filters.from) : null;
    const to = filters.to ? parseDateOnly(filters.to) : null;
    if (filters.from && !from) throw new ApiError(400, "开始日期无效");
    if (filters.to && !to) throw new ApiError(400, "结束日期无效");
    if (from && to && from > to) throw new ApiError(400, "日期区间无效");
    where.docDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) } : {}),
    };
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { docNo: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } },
      { ocrSupplierName: { contains: q, mode: "insensitive" } },
      { project: { name: { contains: q, mode: "insensitive" } } },
      { items: { some: { OR: [
        { name: { contains: q, mode: "insensitive" } },
        { rawName: { contains: q, mode: "insensitive" } },
        { ingredient: { name: { contains: q, mode: "insensitive" } } },
        { ingredient: { aliases: { some: { alias: { contains: q, mode: "insensitive" } } } } },
      ] } } },
      { AND: [
        { notes: { contains: q, mode: "insensitive" } },
        ...(user.globalRole === "STAFF" ? [{ projectId: { in: user.memberships
          .filter(row=>documentVisibility(user,row.projectId).sensitiveDetails).map(row=>row.projectId) } }] : []),
      ] },
    ];
  }
  const documents = await db.document.findMany({
    where,
    include: {
      project: true,
      supplier: true,
      pages: { orderBy: { pageNo: "asc" }, take: 1, select: { objectKey: true, processedObjectKey: true } },
      items: { select: { id: true } },
      checks: {
        where: { status: "OPEN" },
        select: { severity: true },
      },
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(200, Math.max(1, Math.trunc(filters.limit || 80))),
  });
  return documents.map((document) => ({
    id: document.id,
    docNo: document.docNo,
    docDate: dateOnly(document.docDate),
    projectId: document.projectId,
    projectName: document.project.name,
    supplierId: document.supplierId,
    supplierName: document.supplier?.name || document.ocrSupplierName,
    previewImageUrl: documentVisibility(user, document.projectId).sourceImages && document.pages[0]
      ? document.pages[0].objectKey.startsWith("demo/") ? "/sample-delivery.svg"
        : `/api/files?key=${encodeURIComponent(document.pages[0].processedObjectKey || document.pages[0].objectKey)}`
      : null,
    status: document.status,
    totalAmount: hasPermission(user,"document.view_amount",document.projectId)?Number(document.totalAmount):null,
    itemCount: document.items.length,
    errorCount: document.checks.filter((check) => check.severity === "ERROR")
      .length,
    warningCount: document.checks.filter(
      (check) => check.severity === "WARNING",
    ).length,
    createdAt: document.createdAt.toISOString(),
  }));
}

export async function getDocumentDetail(
  user: SessionUser,
  documentId: string,
) {
  const db = await getReadyDb();
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: detailInclude,
  });
  if (!document) throw new ApiError(404, "单据不存在");
  if (!canAccessDocument(user, document)) {
    throw new ApiError(403, "无权查看该单据");
  }
  const [audit, approvals, lastOcr] = await Promise.all([
    db.auditLog.findMany({
      where: { documentId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.approvalRecord.findMany({
      where: { documentId },
      include: { reviewer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.auditLog.findFirst({
      where: { documentId, action: { in: ["ocr.completed", "ocr.failed", "document.page_deleted"] } },
      orderBy: { createdAt: "desc" },
      select: { action: true, afterValue: true },
    }),
  ]);
  const ocrDetail = lastOcr?.afterValue && typeof lastOcr.afterValue === "object"
    && !Array.isArray(lastOcr.afterValue) ? lastOcr.afterValue : {};
  const ocrWarnings = Array.isArray(ocrDetail.warnings)
    ? ocrDetail.warnings.filter((value): value is string => typeof value === "string")
    : [];
  // Older jobs recorded zero rows as success. Expose their failure without
  // rewriting historical records or invoking billable cloud recognition.
  const legacyEmptyError = lastOcr?.action === "ocr.completed"
    && !document.items.length && document.status === "DRAFT"
      ? "上次识别未提取到明细，原图已保留；请在更新后按同一供应商合并重试，或继续人工录入"
      : "";
  const dto = visibleDocument(user,documentDto(document));
  const sourcePages = Array.isArray(ocrDetail.pages) ? ocrDetail.pages : [];
  const duplicateSources = canViewCheckDetails(user,document.projectId,"duplicate_image") && document.pages.some(p=>p.sha256) ? await db.document.findMany({where:{AND:[documentReadScope(user)], id:{not:document.id},pages:{some:{sha256:{in:document.pages.map(p=>p.sha256).filter(Boolean)}}}},select:{id:true,docDate:true,status:true,project:{select:{name:true}}}}) : [];
  return {
    document: {
      ...dto, duplicateSources:duplicateSources.map(d=>({id:d.id,date:dateOnly(d.docDate),status:d.status,projectName:d.project.name})), ocrError: dto.ocrError || legacyEmptyError, ocrWarnings:dto.visibility.sensitiveDetails?ocrWarnings:[],
      pages: dto.pages.map(page => {
        const source = sourcePages.find(value => value && typeof value === "object"
          && !Array.isArray(value) && value.pageNo === page.pageNo);
        const fields = source && typeof source === "object" && !Array.isArray(source) ? source : {};
        return {
          ...page,
          sourceDocNo: page.sourceDocNo || (typeof fields.sourceDocNo === "string" ? fields.sourceDocNo : ""),
          sourceDocDate: page.sourceDocDate || (typeof fields.sourceDocDate === "string" ? fields.sourceDocDate : ""),
        };
      }),
    },
    audit: audit.map((entry) => ({
      id: entry.id,
      action: entry.action,
      userName: entry.user?.name || "系统",
      detail: dto.visibility.sensitiveDetails?entry.afterValue:null,
      createdAt: entry.createdAt.toISOString(),
    })),
    approvals: approvals.map((approval) => ({
      id: approval.id,
      action: approval.action,
      reviewerName: approval.reviewer.name,
      note: dto.visibility.sensitiveDetails?approval.note:"",
      createdAt: approval.createdAt.toISOString(),
    })),
  };
}

type ItemInput = {
  id?: string;
  lineNo?: number;
  name: string;
  rawName?: string;
  spec?: string;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  amount: number | null;
  roundingConfirmed?: boolean;
  confidence?: number;
  ingredientId?: string | null;
  matchStatus?: "MATCHED" | "SIMILAR" | "NEW" | "UNMATCHED";
  matchScore?: number | null;
};

export async function saveDocument(
  user: SessionUser,
  documentId: string,
  input: {
    version: number;
    docNo?: string;
    docDate: string;
    projectId: string;
    supplierId?: string | null;
    items: ItemInput[];
    taxAmount?: number | null;
    totalAmount?: number | null;
    notes?: string;
  },
) {
  const db = await getReadyDb();
  const existing = await db.document.findUnique({
    where: { id: documentId },
    include: { items: true },
  });
  if (!existing) throw new ApiError(404, "单据不存在");
  if (existing.status === "PROCESSING") {
    throw new ApiError(409, "正在识别，请等待识别完成后再修改");
  }
  if (!canEditDocument(user, existing)) throw new ApiError(403, "无权修改该单据");
  if (existing.version !== input.version) {
    throw new ApiError(409, "单据已被其他人修改，请刷新后重试", {
      currentVersion: existing.version,
    });
  }
  const docDate = parseDateOnly(input.docDate);
  if (!docDate) throw new ApiError(400, "单据日期无效");
  if (input.projectId !== existing.projectId) {
    throw new ApiError(400, "单据创建后不能变更项目点");
  }
  if (!Array.isArray(input.items) || input.items.length > 200) {
    throw new ApiError(400, "明细行数不合法");
  }
  if (input.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: {
        id: input.supplierId,
        // 单据原有供应商可能因主数据合并而停用，未变更时必须允许保存。
        ...(input.supplierId === existing.supplierId ? {} : { active: true }),
      },
    });
    if (!supplier) throw new ApiError(400, "供应商不存在或已停用");
  }
  const ingredientIds = Array.from(
    new Set(
      input.items
        .map((item) => item.ingredientId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const existingIngredientIds = new Set(
    existing.items
      .map((item) => item.ingredientId)
      .filter((id): id is string => Boolean(id)),
  );
  const newIngredientIds = ingredientIds.filter(
    (id) => !existingIngredientIds.has(id),
  );
  if (newIngredientIds.length) {
    const count = await db.ingredient.count({
      where: { id: { in: newIngredientIds }, active: true },
    });
    if (count !== newIngredientIds.length) {
      throw new ApiError(400, "部分原材料主数据不存在或已停用");
    }
  }

  const visibility=documentVisibility(user,existing.projectId);
  // The hidden fields supplied by clients are ignored, including forged values.
  input.items=input.items.map(item=>{
    const previous=existing.items.find(row=>row.id===item.id);
    return {...item,unitPrice:visibility.unitPrice?item.unitPrice:Number(previous?.unitPrice || 0),
      amount:visibility.amount?item.amount:Number(previous?.amount || 0),
      ...(!visibility.unitPrice || !visibility.amount?{roundingConfirmed:undefined}:{})};
  });
  function resolveRounding(item: ItemInput) {
    const previous = existing!.items.find(row => row.id === item.id);
    const next: RoundingItem = { name: String(item.name || "").trim(), unit: normalizeUnit(item.unit || ""), ingredientId: item.ingredientId || null, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), amount: Number(item.amount) };
    if (item.roundingConfirmed === false) return Prisma.DbNull;
    if (validRounding(next, previous?.roundingAdjustment)) return previous!.roundingAdjustment as Prisma.InputJsonValue;
    if (item.roundingConfirmed !== true) return Prisma.DbNull;
    if (!canConfirmRounding(next)) throw new ApiError(400, "仅允许确认单行减少0.01至0.99元的抹零，请修正金额");
    return { ...next, adjustmentAmount: roundMoney(next.amount - roundMoney(next.quantity * next.unitPrice)), confirmedBy: user.id, confirmedAt: new Date().toISOString(), reason: "供应商抹零" };
  }
  const cleanItems = input.items
    .map((item, index) => ({
      lineNo: index + 1,
      rawName: String(item.rawName || item.name || "").trim(),
      name: String(item.name || "").trim(),
      spec: String(item.spec || "").trim() === String(item.unit || "").trim()
        ? normalizeUnit(item.unit || "") : String(item.spec || "").trim(),
      unit: normalizeUnit(item.unit || ""),
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      amount: Number(item.amount) || 0,
      roundingAdjustment: resolveRounding(item),
      confidence:
        item.confidence === undefined ? 1 : Math.max(0, Math.min(1, item.confidence)),
      ingredientId: item.ingredientId || null,
      matchStatus: item.ingredientId ? ("MATCHED" as const) : (item.matchStatus || "UNMATCHED"),
      matchScore: item.matchScore ?? null,
      // Retain server-owned OCR provenance through manual corrections. Never
      // accept a client-supplied source page or infer it from a reordered line.
      rawOcr: (existing.items.find(previous => previous.id === item.id)?.rawOcr || {}) as Prisma.InputJsonValue,
    }))
    .filter(
      (item) =>
        item.name ||
        item.quantity ||
        item.unitPrice ||
        item.amount,
    );
  const subtotal = roundMoney(
    cleanItems.reduce((sum, item) => sum + item.amount, 0),
  );
  const taxAmount = visibility.amount?(Number(input.taxAmount) || 0):Number(existing.taxAmount);
  const suppliedTotal =
    !visibility.amount ? Number(existing.totalAmount) : input.totalAmount == null ? subtotal + taxAmount : Number(input.totalAmount);
  const totalAmount =
    Math.abs(suppliedTotal - subtotal) > 0.011 ? roundMoney(suppliedTotal) : subtotal;
  const decimalValues = [subtotal, taxAmount, totalAmount,
    ...cleanItems.flatMap((item) => [item.quantity, item.unitPrice, item.amount, item.quantity * item.unitPrice]),
  ];
  if (decimalValues.some((value) => !Number.isFinite(value) || Math.abs(value) >= 10_000_000_000)) {
    throw new ApiError(400, "数量或金额超出系统支持范围，请核对输入");
  }

  const updated = await db.$transaction(async (tx) => {
    await claimDocumentVersion(tx, existing);
    await tx.documentItem.deleteMany({ where: { documentId } });
    await tx.document.update({
      where: { id: documentId },
      data: {
        docNo: existing.docNo,
        docDate,
        supplierId: input.supplierId || null,
        supplierMatchStatus: input.supplierId ? "MATCHED" : "UNMATCHED",
        supplierMatchScore: input.supplierId ? 1 : null,
        subtotal,
        taxAmount,
        totalAmount,
        notes: visibility.sensitiveDetails?String(input.notes || ""):existing.notes,
        items: {
          create: cleanItems,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "document",
        entityId: documentId,
        documentId,
        userId: user.id,
        action: "document.updated",
        beforeValue: {
          version: existing.version,
          docNo: existing.docNo,
          docDate: existing.docDate.toISOString(),
          totalAmount: Number(existing.totalAmount),
          supplierId: existing.supplierId,
          items: existing.items.map((item) => ({
            name: item.name,
            spec: item.spec,
            unit: item.unit,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            amount: Number(item.amount),
            roundingAdjustment: item.roundingAdjustment,
            ingredientId: item.ingredientId,
          })),
        },
        afterValue: {
          docNo: existing.docNo,
          docDate: docDate.toISOString(),
          totalAmount,
          supplierId: input.supplierId || null,
          items: cleanItems.map((item) => ({
            name: item.name,
            spec: item.spec,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            roundingAdjustment: item.roundingAdjustment === Prisma.DbNull ? null : item.roundingAdjustment as Prisma.InputJsonValue,
            ingredientId: item.ingredientId,
          })),
        },
      },
    });
    await recomputeDocumentChecksInTransaction(tx, documentId);
    return tx.document.findUniqueOrThrow({
      where: { id: documentId },
      include: detailInclude,
    });
  });
  const refreshed = await db.document.findUniqueOrThrow({
    where: { id: documentId },
    include: detailInclude,
  });
  return {
    document: visibleDocument(user,documentDto(refreshed)),
    previous: visibleDocument(user,documentDto(updated)),
  };
}

export async function submitDocument(
  user: SessionUser,
  documentId: string,
  expectedVersion?: number,
) {
  const db = await getReadyDb();
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { items: true, project: true, supplier: true },
  });
  if (!document) throw new ApiError(404, "单据不存在");
  if (!canAccessDocument(user, document)) {
    throw new ApiError(403, "无权提交该单据");
  }
  if (!canSubmitRecord(user, document)) {
    throw new ApiError(403, "无权提交该单据");
  }
  if (expectedVersion !== undefined && expectedVersion !== document.version) throw new ApiError(409,"单据已修改，请重新核对");
  if (document.batchId && (document.checkedVersion !== document.version || document.ocrError)) throw new ApiError(422,"请先在批次核对页确认此单据");
  if (!["DRAFT", "NEEDS_REVISION"].includes(document.status)) {
    throw new ApiError(409, "当前状态不能提交");
  }
  if (!document.supplierId) throw new ApiError(422, "请先确认供应商");
  if (!document.items.length) throw new ApiError(422, "单据没有明细");
  const missingIngredients = document.items.filter((item) => !item.ingredientId);
  if (missingIngredients.length) {
    throw new ApiError(
      422,
      `仍有 ${missingIngredients.length} 行原材料未确认，请先匹配或新建品名`,
    );
  }
  const updated = await db.$transaction(async (tx) => {
    await claimDocumentVersion(tx, document);
    await recomputeDocumentChecksInTransaction(tx, documentId);
    if (document.batchId && await tx.checkResult.count({where:{documentId,status:"OPEN",severity:"ERROR"}})) throw new ApiError(422,"存在严重问题，请处理后重新核对");
    const result = await tx.document.update({
      where: { id: documentId },
      data: { status: "PENDING_REVIEW", submittedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        entityType: "document",
        entityId: documentId,
        documentId,
        userId: user.id,
        action: "document.submitted",
        afterValue: {
          totalAmount: Number(document.totalAmount),
          supplier: document.supplier?.name || "",
        },
      },
    });
    return result;
  });
  return { id: updated.id, status: updated.status };
}

export async function reviewDocument(
  user: SessionUser,
  documentId: string,
  input: {
    action: "approve" | "return";
    note?: string;
    override?: boolean;
  },
) {
  const db = await getReadyDb();
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: {
      items: true,
      checks: { where: { status: "OPEN" } },
      project: true,
      supplier: true,
    },
  });
  if (!document) throw new ApiError(404, "单据不存在");
  if (!canReviewDocument(user, document)) {
    throw new ApiError(403, "只有本项目主管可以审核");
  }
  const actionPermission = input.action === "approve" ? "document.approve" : "document.return";
  if (!hasPermission(user, actionPermission, document.projectId) || input.override &&
      (input.action !== "approve" || !hasPermission(user,"document.override",document.projectId))) {
    throw new ApiError(403, "当前角色没有此审核操作权限");
  }
  const note = String(input.note || "").trim();
  if (input.override && !note) {
    throw new ApiError(400, "强制通过必须填写原因");
  }
  if (input.action === "return" && !note) {
    throw new ApiError(400, "退回补充必须填写原因");
  }
  const status = input.action === "approve" ? "APPROVED" : "NEEDS_REVISION";
  await db.$transaction(async (tx) => {
    await claimDocumentVersion(tx, document);
    const checks = await recomputeDocumentChecksInTransaction(tx, documentId);
    const errors = checks.filter((check) => check.severity === "ERROR");
    if (input.action === "approve" && errors.length && !input.override) {
      throw new ApiError(422, "存在必须处理的严重异常，不能普通通过", {
        checks: errors.map(check=>canViewCheckDetails(user,document.projectId,check.type)?check:
          {...check,detail:"详细核对依据已按查看权限隐藏",expectedValue:null,actualValue:null}),
      });
    }
    await tx.document.update({
      where: { id: documentId },
      data: {
        status,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: note,
        overrideReason: input.override ? note : "",
      },
    });
    await tx.approvalRecord.create({
      data: {
        documentId,
        reviewerId: user.id,
        action: input.override ? "OVERRIDE_APPROVE" : input.action === "approve" ? "APPROVE" : "RETURN",
        note,
        beforeValue: { status: document.status },
        afterValue: {
          status,
          errorCount: errors.length,
          override: Boolean(input.override),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "document",
        entityId: documentId,
        documentId,
        userId: user.id,
        action: input.action === "approve" ? "review.approved" : "review.returned",
        beforeValue: { status: document.status },
        afterValue: {
          status,
          note,
          override: Boolean(input.override),
        },
      },
    });
    if (input.action === "approve") {
      await tx.checkResult.updateMany({
        where: { documentId, status: "OPEN" },
        data: { status: "RESOLVED" },
      });
    }
  });
  return { id: documentId, status };
}

export async function withdrawApproval(
  user: SessionUser,
  documentId: string,
  input: { note: string },
) {
  const db = await getReadyDb();
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { project: true, supplier: true },
  });
  if (!document) throw new ApiError(404, "单据不存在");
  if (user.globalRole === "FINANCE") {
    throw new ApiError(403, "财务账号只读，不能撤回审核");
  }
  if (!canAccessDocument(user,document) || !hasPermission(user,"document.withdraw",document.projectId)) {
    throw new ApiError(403, "只有项目主管或管理员可以撤回审核");
  }
  if (document.status !== "APPROVED") {
    throw new ApiError(409, "只有已通过单据可以撤回审核");
  }
  const note = String(input.note || "").trim();
  if (!note) throw new ApiError(400, "撤回审核必须填写原因");
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.document.updateMany({
      where: { id: documentId, status: "APPROVED", version: document.version },
      data: {
        status: "PENDING_REVIEW",
        reviewedById: null,
        reviewedAt: null,
        reviewNote: note,
        overrideReason: "",
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new ApiError(409, "单据状态已变化，请刷新后重试");
    }
    // 撤回记录写入审计日志；ApprovalAction 枚举无 WITHDRAW，避免为此新增迁移。
    await tx.auditLog.create({
      data: {
        entityType: "document",
        entityId: documentId,
        documentId,
        userId: user.id,
        action: "review.withdrawn",
        beforeValue: { status: document.status },
        afterValue: { status: "PENDING_REVIEW", note },
      },
    });
    // 审核通过时已关闭的异常重新打开，供修改后重新核对。
    await tx.checkResult.updateMany({
      where: { documentId, status: "RESOLVED" },
      data: { status: "OPEN" },
    });
    return { id: documentId, status: "PENDING_REVIEW" as const };
  });
  return { id: updated.id, status: updated.status };
}

export async function recheckDocument(user: SessionUser, documentId: string) {
  const db = await getReadyDb();
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) throw new ApiError(404, "单据不存在");
  if (!canAccessDocument(user, document)) throw new ApiError(403, "无权操作该单据");
  if (!canEditDocument(user, document)) throw new ApiError(403, "当前账号只读，不能重新比对");
  await recomputeDocumentChecks(db, documentId);
  return getDocumentDetail(user, documentId);
}
