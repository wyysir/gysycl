import { documentReadScope } from "./read-scope";
import { getReadyDb } from "@/lib/bootstrap";
import type { SessionUser } from "./auth";

export async function frequentMaterials(user: SessionUser) {
  const db = await getReadyDb();
  const rows = await db.documentItem.groupBy({
    by: ["ingredientId"],
    where: { ingredientId: { not: null }, ingredient: { active: true }, document: documentReadScope(user) },
    _count: { ingredientId: true },
    orderBy: { _count: { ingredientId: "desc" } }, take: 40,
  });
  const materials = await db.ingredient.findMany({ where: { id: { in: rows.map(row => row.ingredientId!) }, active: true }, select: { id: true, name: true, spec: true, unit: true } });
  return rows.flatMap(row => { const material = materials.find(item => item.id === row.ingredientId); return material ? [material] : []; });
}
