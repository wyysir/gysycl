import { Prisma } from "@/generated/prisma/client";
import { chooseMaterial, choiceUnit, readMaterialChoice, type MaterialChoice } from "@/lib/material-choice";
import { normalizeName, normalizeSpecification, productSpecification } from "@/lib/text";
import { createMaterialCatalogue, materialGroupKey } from "./material-catalogue";
import { claimDocumentVersion } from "./document-lock";
import { recomputeDocumentChecksInTransaction } from "./checks";
import { ApiError } from "./errors";
import type { Db } from "@/lib/prisma";

type LinkItem = { name: string; spec?: string; unit: string; ingredientId?: string | null; materialChoice?: MaterialChoice | null; matchStatus?: string; matchScore?: number | null };
type Previous = { name: string; spec: string; unit: string; ingredientId: string | null; rawOcr: unknown };
type Catalogue = Awaited<ReturnType<typeof createMaterialCatalogue>>;
export function materialProvenance(raw: unknown) {
  const object = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { raw: object, originalUnit: typeof object.unit === "string" ? object.unit : "", choice: readMaterialChoice(object.materialChoice) };
}
export function resolveMaterialLink<T extends LinkItem>(catalogue: Catalogue, item: T, previous: Previous | null, auto = false) {
  const origin = materialProvenance(previous?.rawOcr), requested = readMaterialChoice(item.materialChoice);
  const previousChoice = origin.choice && normalizeName(origin.choice.name) === normalizeName(item.name) && normalizeSpecification(origin.choice.spec) === normalizeSpecification(item.spec || "") ? origin.choice : null;
  let choice = requested || (item.materialChoice === null ? null : previousChoice);
  let group = choice && catalogue.groups.get(choice.key);
  if (group && (normalizeName(group.name) !== normalizeName(item.name) || normalizeSpecification(group.spec) !== normalizeSpecification(item.spec || ""))) group = undefined;
  if (requested && !group) {
    // A stopped master must not invalidate an unchanged historical link.
    // Retain only server-owned metadata; it cannot authorize a new selection.
    if (previous?.ingredientId && previous.ingredientId === item.ingredientId && origin.choice?.key === requested.key &&
      normalizeName(previous.name) === normalizeName(item.name) && normalizeSpecification(previous.spec) === normalizeSpecification(item.spec || "") && choiceUnit(previous.unit) === choiceUnit(item.unit)) {
      return { ...item, ingredientId: previous.ingredientId, materialChoice: origin.choice, rawOcr: origin.raw };
    }
    throw new ApiError(409, "所选品名或规格已变化，请重新检索确认");
  }
  if (!group && !choice && item.ingredientId) {
    const record = catalogue.rows.find(r => r.id === item.ingredientId);
    if (record && normalizeName(record.name) === normalizeName(item.name) && normalizeSpecification(productSpecification(record.spec, record.unit)) === normalizeSpecification(productSpecification(item.spec || "", item.unit))) group = catalogue.groups.get(materialGroupKey(record.name, productSpecification(record.spec, record.unit)));
  }
  if (!group && auto) group = catalogue.exact(item.name, item.spec || "") || undefined;
  if (!group) return { ...item, ingredientId: item.ingredientId || null, materialChoice: null, rawOcr: { ...origin.raw, materialChoice: null } };
  if (requested?.recordVersion !== undefined && item.ingredientId && item.ingredientId !== previous?.ingredientId) {
    const record = group.options.find(o => o.id === item.ingredientId);
    if (!record || record.version !== requested.recordVersion) throw new ApiError(409, "所选原材料已变化，请重新检索后选择");
  }
  if (choice?.source === "ocr" && (!origin.originalUnit || choiceUnit(origin.originalUnit) !== choiceUnit(item.unit))) choice = { ...choice, source: "unknown", confirmedUnit: null };
  const patch = chooseMaterial({ ...item, spec: item.spec || "", materialChoice: choice, originalUnit: origin.originalUnit }, group);
  // Original OCR fields are immutable, including the unit that was actually read.
  return { ...item, ...patch, rawOcr: { ...origin.raw, materialChoice: patch.materialChoice } };
}

/** Explicit recheck only. No paid inference, submitted/approved history, or existing links are rewritten. */
export async function refreshDraftMaterialLinks(db: Db, documentId: string, userId: string, expectedVersion: number) {
  return db.$transaction(async tx => {
    const doc = await tx.document.findUnique({ where: { id: documentId }, include: { items: true } });
    if (!doc || doc.version !== expectedVersion) throw new ApiError(409, "单据已变化，请刷新后重新比对");
    if (!["DRAFT", "NEEDS_REVISION"].includes(doc.status)) {
      await recomputeDocumentChecksInTransaction(tx, documentId); return 0;
    }
    const catalogue = await createMaterialCatalogue(tx);
    const changes = doc.items.filter(i => !i.ingredientId).flatMap(item => {
      const patch = resolveMaterialLink(catalogue, { ...item, materialChoice: materialProvenance(item.rawOcr).choice }, item, true);
      if (!patch.materialChoice) return [];
      if (patch.ingredientId === item.ingredientId && patch.name === item.name && patch.spec === item.spec && patch.unit === item.unit && JSON.stringify(patch.materialChoice) === JSON.stringify(materialProvenance(item.rawOcr).choice)) return [];
      return [{ item, patch }];
    });
    if (changes.length) {
      await claimDocumentVersion(tx, doc);
      await tx.document.update({ where: { id: documentId }, data: { checkedVersion: null, checkedAt: null, checkedById: null } });
      for (const { item, patch } of changes) await tx.documentItem.update({ where: { id: item.id }, data: {
        name: patch.name, spec: patch.spec || "", unit: patch.unit, ingredientId: patch.ingredientId || null,
        matchStatus: patch.ingredientId ? "MATCHED" : "UNMATCHED", matchScore: patch.ingredientId ? 1 : null,
        rawOcr: patch.rawOcr as Prisma.InputJsonValue, measurementSnapshot: Prisma.DbNull,
      } });
      await tx.auditLog.create({ data: { entityType: "document", entityId: documentId, documentId, userId,
        action: "document.materials_relinked", beforeValue: { version: doc.version },
        afterValue: { rows: changes.length, inferenceCalled: false, originalNumbersRetained: true,
          links: changes.map(({ item, patch }) => ({ itemId: item.id, ingredientId: patch.ingredientId || null, previousUnit: item.unit, unit: patch.unit })) } } });
    }
    await recomputeDocumentChecksInTransaction(tx, documentId);
    return changes.length;
  }, { timeout: 30000 });
}
