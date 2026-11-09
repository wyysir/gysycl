import { assertCategoryActive } from "./ingredient-maintenance";
import { hasPermission } from "@/lib/permissions";
import { getReadyDb } from "@/lib/bootstrap";
import { normalizeName, normalizeUnit } from "@/lib/text";
import { ApiError, canEditDocument, isAdmin, type SessionUser } from "./auth";
import { recomputeDocumentChecks, recomputeDocumentChecksInTransaction } from "./checks";
import { claimDocumentVersion } from "./document-lock";

async function assertSourceDocument(
  user: SessionUser,
  documentId: string | undefined,
  itemId?: string,
) {
  const db = await getReadyDb();
  if (!documentId) return null;
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { items: true },
  });
  if (!document) throw new ApiError(404, "来源单据不存在");
  if (document.status === "PROCESSING") {
    throw new ApiError(409, "正在识别，请等待识别完成后再修改");
  }
  if (!canEditDocument(user, document)) {
    throw new ApiError(
      403,
      "来源单据当前状态不允许修改，已通过单据请走变更流程",
    );
  }
  if (itemId && !document.items.some((item) => item.id === itemId)) {
    throw new ApiError(400, "来源明细不存在");
  }
  return document;
}

export async function createSupplierFromDocument(
  user: SessionUser,
  input: {
    name: string;
    rawName?: string;
    sourceDocumentId?: string;
    contactName?: string;
    contactPhone?: string;
  },
) {
  if (!hasPermission(user,"master.create")) throw new ApiError(403,"当前角色没有新建基础资料权限");
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "供应商名称不能为空");
  const db = await getReadyDb();
  const normalizedName = normalizeName(name);
  const existing = await db.supplier.findFirst({
    where: {
      OR: [
        { normalizedName },
        {
          aliases: {
            some: { normalizedAlias: normalizedName },
          },
        },
      ],
      active: true,
    },
  });
  if (existing) {
    throw new ApiError(409, `数据库中已存在“${existing.name}”，请直接选择`, {
      candidate: { id: existing.id, name: existing.name },
    });
  }
  const source = await assertSourceDocument(
    user,
    input.sourceDocumentId,
  );
  let documentVersion: number | null = null;
  const supplier = await db.$transaction(async (tx) => {
    if (source) await claimDocumentVersion(tx, source);
    const created = await tx.supplier.create({
      data: {
        name,
        normalizedName,
        contactName: input.contactName || "",
        contactPhone: input.contactPhone || "",
        sourceDocumentId: source?.id || null,
        createdById: user.id,
        aliases: input.rawName && normalizeName(input.rawName) !== normalizedName
          ? {
              create: {
                alias: input.rawName,
                normalizedAlias: normalizeName(input.rawName),
              },
            }
          : undefined,
      },
    });
    if (source) {
      const updatedSource = await tx.document.update({
        where: { id: source.id },
        data: {
          supplierId: created.id,
          supplierMatchStatus: "MATCHED",
          supplierMatchScore: 1,
        },
      });
      documentVersion = updatedSource.version;
      await recomputeDocumentChecksInTransaction(tx, source.id);
    }
    await tx.auditLog.create({
      data: {
        entityType: "supplier",
        entityId: created.id,
        documentId: source?.id || null,
        userId: user.id,
        action: "supplier.created_from_document",
        afterValue: { name: created.name, rawName: input.rawName || "" },
      },
    });
    return created;
  });
  return { id: supplier.id, name: supplier.name, documentVersion };
}

export async function createIngredientFromDocument(
  user: SessionUser,
  input: {
    name: string;
    rawName?: string;
    spec?: string;
    unit: string;
    category?: string;
    notes?: string;
    aliases?: string[];
    active?: boolean;
    sourceDocumentId?: string;
    sourceItemId?: string;
  },
) {
  if (!hasPermission(user,input.sourceDocumentId ? "master.create" : "master.create_global")) {
    throw new ApiError(403,"当前角色没有此新建基础资料权限");
  }
  const name = input.name.trim();
  const unit = normalizeUnit(input.unit);
  const spec = !input.spec || input.spec.trim() === input.unit.trim() ? unit : input.spec.trim();
  if (!name) throw new ApiError(400, "品名不能为空");
  if (!unit) throw new ApiError(400, "新建原材料必须填写单位");
  const db = await getReadyDb();
  const normalizedName = normalizeName(name);
  const normalizedSpec = normalizeName(spec);
  const existing = await db.ingredient.findFirst({
    where: {
      OR: [
        { normalizedName, normalizedSpec, unit },
        { unit, aliases: { some: { normalizedAlias: normalizedName } } },
      ],
      active: true,
    },
  });
  if (existing) {
    throw new ApiError(409, `数据库中已存在“${existing.name}”，请直接选择`, {
      candidate: {
        id: existing.id,
        name: existing.name,
        spec: existing.spec,
        unit: existing.unit,
      },
    });
  }
  const source = await assertSourceDocument(
    user,
    input.sourceDocumentId,
    input.sourceItemId,
  );
  let documentVersion: number | null = null;
  const ingredient = await db.$transaction(async (tx) => {
    if (source && input.sourceItemId) await claimDocumentVersion(tx, source);
    await assertCategoryActive(tx, input.category?.trim() || "");
    const created = await tx.ingredient.create({
      data: {
        name,
        normalizedName,
        spec,
        normalizedSpec,
        unit,
        category: input.category || "",
        notes: input.notes || "",
        active: hasPermission(user,"master.manage") ? input.active ?? true : true,
        sourceDocumentId: source?.id || null,
        createdById: user.id,
        aliases: {create: [...new Map([...(input.aliases||[]),...(input.rawName?[input.rawName]:[])].map(alias=>[normalizeName(alias),alias.trim()])).entries()]
          .filter(([key])=>key&&key!==normalizedName).map(([normalizedAlias,alias])=>({alias,normalizedAlias}))},
      },
    });
    if (source && input.sourceItemId) {
      await tx.documentItem.update({
        where: { id: input.sourceItemId },
        data: {
          ingredientId: created.id,
          name: created.name,
          spec,
          unit,
          matchStatus: "MATCHED",
          matchScore: 1,
        },
      });
      const updatedSource = await tx.document.update({
        where: { id: source.id },
        data: { updatedAt: new Date() },
      });
      documentVersion = updatedSource.version;
      await recomputeDocumentChecksInTransaction(tx, source.id);
    }
    await tx.auditLog.create({
      data: {
        entityType: "ingredient",
        entityId: created.id,
        documentId: source?.id || null,
        userId: user.id,
        action: "ingredient.created_from_document",
        afterValue: {
          name: created.name,
          spec: created.spec,
          unit: created.unit,
          rawName: input.rawName || "",
        },
      },
    });
    return created;
  });
  return {
    id: ingredient.id,
    name: ingredient.name,
    spec: ingredient.spec,
    unit: ingredient.unit,
    documentVersion,
  };
}

export async function mergeMasterData(
  user: SessionUser,
  input: {
    type: "supplier" | "ingredient";
    sourceId: string;
    targetId: string;
  },
) {
  if (!hasPermission(user,"master.manage")) throw new ApiError(403, "当前角色没有合并基础资料权限");
  if (input.sourceId === input.targetId) {
    throw new ApiError(400, "不能合并到自身");
  }
  const db = await getReadyDb();
  if (input.type === "supplier") {
    const [source, target] = await Promise.all([
      db.supplier.findUnique({
        where: { id: input.sourceId },
        include: { aliases: true },
      }),
      db.supplier.findUnique({ where: { id: input.targetId } }),
    ]);
    if (!source || !target) throw new ApiError(404, "供应商不存在");
    if (!target.active) {
      throw new ApiError(400, "目标供应商已停用，请选择其他目标记录");
    }
    const affectedDocuments = await db.document.findMany({
      where: { supplierId: source.id, status: { not: "APPROVED" } },
      select: { id: true },
    });
    await db.$transaction(async (tx) => {
      // 源名称与源别名全部迁移到目标，避免停用后旧别名无法再匹配。
      for (const alias of [
        source.name,
        ...source.aliases.map((item) => item.alias),
      ]) {
        const normalizedAlias = normalizeName(alias);
        if (!normalizedAlias) continue;
        await tx.supplierAlias.upsert({
          where: {
            supplierId_normalizedAlias: {
              supplierId: target.id,
              normalizedAlias,
            },
          },
          update: {},
          create: {
            supplierId: target.id,
            alias,
            normalizedAlias,
          },
        });
      }
      await tx.document.updateMany({
        where: { supplierId: source.id, status: { not: "APPROVED" } },
        data: { supplierId: target.id, version: { increment: 1 } },
      });
      await tx.contract.updateMany({
        where: { supplierId: source.id },
        data: { supplierId: target.id },
      });
      await tx.auditLog.create({
        data: {
          entityType: "supplier",
          entityId: target.id,
          userId: user.id,
          action: "supplier.merged",
          beforeValue: { sourceId: source.id, sourceName: source.name },
          afterValue: {
            targetId: target.id,
            targetName: target.name,
            historyPreserved: true,
            sourceActive: false,
          },
        },
      });
      // 业务确认（2026-10-22）：已通过单据保留原供应商引用，源记录停用而不是删除。
      await tx.supplier.update({
        where: { id: source.id },
        data: { active: false },
      });
    });
    for (const document of affectedDocuments) {
      try {
        const current = await db.document.findUnique({
          where: { id: document.id },
          select: { status: true },
        });
        if (!current || current.status === "APPROVED") continue;
        await recomputeDocumentChecks(db, document.id);
      } catch (error) {
        console.error("合并供应商后重算单据失败", document.id, error);
      }
    }
    return { targetId: target.id, targetName: target.name };
  }

  const [source, target] = await Promise.all([
    db.ingredient.findUnique({
      where: { id: input.sourceId },
      include: { aliases: true },
    }),
    db.ingredient.findUnique({ where: { id: input.targetId } }),
  ]);
  if (!source || !target) throw new ApiError(404, "原材料不存在");
  if (normalizeUnit(source.unit)!==normalizeUnit(target.unit)) throw new ApiError(400,"不同单位的原材料不能合并，请保留各自单位记录");
  if (!target.active) {
    throw new ApiError(400, "目标原材料已停用，请选择其他目标记录");
  }
  const affectedDocuments = await db.document.findMany({
    where: {
      status: { not: "APPROVED" },
      items: { some: { ingredientId: source.id } },
    },
    select: { id: true },
  });
  await db.$transaction(async (tx) => {
    // 源名称与源别名全部迁移到目标，避免停用后旧别名无法再匹配。
    for (const material of [source, target].sort((a,b)=>a.id.localeCompare(b.id))) {
      const claimed = await tx.ingredient.updateMany({where:{id:material.id,version:material.version},data:{version:{increment:1}}});
      if(claimed.count!==1) throw new ApiError(409,"材料已被修改，请刷新后重新合并");
    }
    for (const alias of [
      source.name,
      ...source.aliases.map((item) => item.alias),
    ]) {
      const normalizedAlias = normalizeName(alias);
      if (!normalizedAlias) continue;
      await tx.ingredientAlias.upsert({
        where: {
          ingredientId_normalizedAlias: {
            ingredientId: target.id,
            normalizedAlias,
          },
        },
        update: {},
        create: {
          ingredientId: target.id,
          alias,
          normalizedAlias,
        },
      });
    }
    // 事务内重新确认可写单据，避免预查询后并发审核通过的单据被改写。
    const writableDocumentIds = (
      await tx.document.findMany({
        where: {
          id: { in: affectedDocuments.map((document) => document.id) },
          status: { not: "APPROVED" },
        },
        select: { id: true },
      })
    ).map((document) => document.id);
    await tx.documentItem.updateMany({
      where: {
        ingredientId: source.id,
        documentId: { in: writableDocumentIds },
        document: { status: { not: "APPROVED" } },
      },
      data: {
        ingredientId: target.id,
        name: target.name,
        spec: target.spec,
        unit: target.unit,
        matchStatus: "MATCHED",
      },
    });
    await tx.document.updateMany({
      where: {
        id: { in: writableDocumentIds },
        status: { not: "APPROVED" },
      },
      data: { version: { increment: 1 } },
    });
    await tx.contract.updateMany({
      where: { ingredientId: source.id },
      data: { ingredientId: target.id },
    });
    await tx.auditLog.create({
      data: {
        entityType: "ingredient",
        entityId: target.id,
        userId: user.id,
        action: "ingredient.merged",
        beforeValue: { sourceId: source.id, sourceName: source.name },
        afterValue: {
          targetId: target.id,
          targetName: target.name,
          historyPreserved: true,
          sourceActive: false,
        },
      },
    });
    // 业务确认（2026-10-22）：已通过单据保留原材料引用，源记录停用而不是删除。
    await tx.ingredient.update({
      where: { id: source.id },
      data: { active: false },
    });
  });
  for (const document of affectedDocuments) {
    try {
      const current = await db.document.findUnique({
        where: { id: document.id },
        select: { status: true },
      });
      if (!current || current.status === "APPROVED") continue;
      await recomputeDocumentChecks(db, document.id);
    } catch (error) {
      console.error("合并原材料后重算单据失败", document.id, error);
    }
  }
  return { targetId: target.id, targetName: target.name };
}
