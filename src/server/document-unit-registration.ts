import { Prisma } from "@/generated/prisma/client";
import { chooseMaterial, choiceUnit, readMaterialChoice } from "@/lib/material-choice";
import { hasPermission } from "@/lib/permissions";
import { normalizeName, normalizeSpecification, productSpecification } from "@/lib/text";
import { ApiError, type SessionUser } from "./auth";
import { assertCategoryActive } from "./ingredient-maintenance";
import { createMaterialCatalogue, materialGroupKey } from "./material-catalogue";

type UnitItem = { name: string; spec: string; unit: string; ingredientId: string | null; rawOcr: Prisma.InputJsonValue };
const choice = (item: UnitItem) => readMaterialChoice((item.rawOcr as Record<string, unknown> | null)?.materialChoice);

/** Only an explicit, confirmed unit on a selected name can add a purchase unit.
 * Called after the document version is claimed, in the same save transaction.
 * OCR, recheck and abandoned typing never create master data.
 */
export async function registerDocumentUnits<T extends UnitItem>(tx: Prisma.TransactionClient, user: SessionUser,
  document: { id: string; projectId: string }, items: T[]) {
  const pending = items.filter(item => {
    const c = choice(item);
    return !item.ingredientId && !!c && c.source === "manual" && !!choiceUnit(item.unit) && c.confirmedUnit === choiceUnit(item.unit);
  });
  if (!pending.length) return;
  // Lock canonical groups in a stable order. Concurrent saves of the same unit
  // reuse one unique record; a failed save rolls back all master changes.
  let catalogue = await createMaterialCatalogue(tx);
  const keys = [...new Set(pending.map(item => choice(item)!.key))].sort();
  for (const key of keys) {
    const group = catalogue.groups.get(key);
    if (!group) throw new ApiError(409, "品名或规格已变化，请重新选择后保存");
    const anchor = [...group.options].sort((a, b) => a.id.localeCompare(b.id))[0];
    await tx.$queryRaw`SELECT id FROM "Ingredient" WHERE id = ${anchor.id} FOR UPDATE`;
  }
  catalogue = await createMaterialCatalogue(tx);
  for (const item of pending) {
    const c = choice(item)!, group = catalogue.groups.get(c.key), unit = choiceUnit(item.unit);
    if (!group || materialGroupKey(item.name, item.spec) !== c.key) throw new ApiError(409, "品名或规格已变化，请重新选择后保存");
    if (unit.length > 30 || /^\d|[=×÷/+<>\x00-\x1f]/.test(unit)) throw new ApiError(400, "请只填写采购单位，如只、箱、包；规格和换算比例请在后台设置");
    let matches = group.options.filter(o => choiceUnit(o.unit) === unit);
    if (matches.length > 1) throw new ApiError(409, "该单位存在重复采购资料，请先在材料库整理");
    if (!matches.length) {
      if (!hasPermission(user, "master.create", document.projectId)) throw new ApiError(403, "没有新增采购单位权限，请由有基础资料新建权限的人员处理");
      const normalizedName = normalizeName(group.name), normalizedSpec = normalizeSpecification(group.spec);
      const sameUnit = await tx.ingredient.findMany({ where: { normalizedName, unit } });
      if (sameUnit.some(r => normalizeSpecification(productSpecification(r.spec, r.unit)) === normalizedSpec && !r.active))
        throw new ApiError(409, "该品名的这个单位已停用，请在材料库核实并启用，不会重复新建");
      const source = await tx.ingredient.findMany({ where: { id: { in: group.options.map(o => o.id) } } });
      const productIds = [...new Set(source.map(r => r.productSpecificationId).filter((id): id is string => !!id))];
      if (productIds.length > 1) throw new ApiError(409, "同名同规格资料存在不同商品归属，请先在后台核实");
      await assertCategoryActive(tx, group.category);
      let productId = productIds[0];
      if (!productId) {
        // Identity only. No statistical unit, box size or conversion is guessed.
        await tx.materialIdentity.createMany({ data: [{ name: group.name, normalizedName, baseUnit: "" }], skipDuplicates: true });
        const material = await tx.materialIdentity.findUniqueOrThrow({ where: { normalizedName } });
        await tx.productSpecification.createMany({ data: [{ materialId: material.id, name: group.name, normalizedName,
          spec: group.spec, normalizedSpec, baseUnit: "", baseQuantity: null }], skipDuplicates: true });
        productId = (await tx.productSpecification.findUniqueOrThrow({ where: { materialId_normalizedName_normalizedSpec: { materialId: material.id, normalizedName, normalizedSpec } } })).id;
      }
      const created = await tx.ingredient.createMany({ data: [{ name: group.name, normalizedName, spec: group.spec, normalizedSpec,
        unit, category: group.category, productSpecificationId: productId, quantityPerProductUnit: null,
        notes: "单据确认新增采购单位；换算比例待后台人工设置", sourceDocumentId: document.id, createdById: user.id }], skipDuplicates: true });
      const record = await tx.ingredient.findUniqueOrThrow({ where: { normalizedName_normalizedSpec_unit: { normalizedName, normalizedSpec, unit } } });
      if (!record.active) throw new ApiError(409, "该单位资料已停用，请先在材料库处理");
      const unassigned = source.filter(r => !r.productSpecificationId);
      if (unassigned.length) await tx.ingredient.updateMany({ where: { id: { in: unassigned.map(r => r.id) }, productSpecificationId: null },
        data: { productSpecificationId: productId, version: { increment: 1 } } });
      if (created.count || unassigned.length) await tx.auditLog.create({ data: { userId: user.id, documentId: document.id,
        entityType: "ingredient", entityId: record.id, action: "ingredient.unit_registered_from_document",
        beforeValue: { existingPurchaseRecords: source.map(r => ({ id: r.id, productSpecificationId: r.productSpecificationId })) },
        afterValue: { name: group.name, spec: group.spec, unit, productSpecificationId: record.productSpecificationId,
          created: !!created.count, conversionConfirmed: false, numbersRetained: true, aliasesAdded: false } } });
      const option = { id: record.id, unit: record.unit, version: record.version, provisional: record.notes.includes("用户指定默认") };
      group.options.push(option); matches = [option];
    }
    const patch = chooseMaterial({ ...item, materialChoice: c }, group, unit);
    Object.assign(item, { ingredientId: patch.ingredientId, name: patch.name, spec: patch.spec, unit: patch.unit,
      matchStatus: patch.matchStatus, matchScore: patch.matchScore,
      rawOcr: { ...(item.rawOcr as Prisma.InputJsonObject), materialChoice: patch.materialChoice } });
  }
}
