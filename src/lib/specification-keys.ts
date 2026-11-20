import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeSpecification, productSpecification } from "./text";

/** Metadata key upgrade only; no source specification, unit, price or quantity is rewritten. */
export async function upgradeSpecificationKeys(db: PrismaClient) {
  const rows = await db.ingredient.findMany({ select: { id: true, normalizedName: true, unit: true, spec: true, normalizedSpec: true } });
  const key = (row: typeof rows[number]) => normalizeSpecification(productSpecification(row.spec, row.unit));
  const changed = rows.filter(row => key(row) !== row.normalizedSpec && !rows.some(other => other.id !== row.id && other.normalizedName === row.normalizedName && other.unit === row.unit && (other.normalizedSpec === key(row) || key(other) === key(row))));
  if (!changed.length) return 0;
  return db.$transaction(async tx => {
    for (const row of changed) await tx.$executeRaw`UPDATE "Ingredient" SET "normalizedSpec" = ${key(row)} WHERE id = ${row.id} AND "normalizedSpec" = ${row.normalizedSpec}`;
    await tx.auditLog.create({ data: { entityType: "maintenance", entityId: "measurement-spec-keys", action: "maintenance.specKeysNormalized", afterValue: { records: changed.length, sourceFieldsRetained: true } } });
    return changed.length;
  });
}
