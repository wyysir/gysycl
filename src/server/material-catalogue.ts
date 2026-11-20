import type { Db } from "@/lib/prisma";
import { createNameScorer, normalizeName, normalizeSpecification, productSpecification } from "@/lib/text";
import type { MaterialGroup } from "@/lib/material-choice";

export const materialGroupKey = (name: string, spec: string) => JSON.stringify([normalizeName(name), normalizeSpecification(spec)]);
export async function createMaterialCatalogue(db: Pick<Db, "ingredient">) {
  const rows = await db.ingredient.findMany({ where: { active: true }, include: { aliases: true }, orderBy: { id: "asc" } });
  const groups = new Map<string, MaterialGroup>();
  for (const row of rows) {
    const spec = productSpecification(row.spec, row.unit), key = materialGroupKey(row.name, spec);
    let g = groups.get(key);
    if (!g) { g = { key, name: row.name, spec, category: row.category, options: [], score: 0 }; groups.set(key, g); }
    g.options.push({ id: row.id, unit: row.unit, version: row.version, provisional: row.notes.includes("用户指定默认") });
  }
  const scorer = createNameScorer();
  function search(query: string, limit = 8) {
    const q = normalizeName(query); if (!q) return [];
    const scores = new Map<string, { score: number; matchedAlias?: string }>();
    for (const row of rows) {
      const key = materialGroupKey(row.name, productSpecification(row.spec, row.unit));
      for (const candidate of [{ name: row.name, alias: undefined as string | undefined }, ...row.aliases.map(a => ({ name: a.alias, alias: a.alias }))]) {
        const score = scorer(query, candidate.name).score;
        if (score >= 0.45 || normalizeName(candidate.name).includes(q) || (normalizeName(candidate.name).length >= 2 && q.includes(normalizeName(candidate.name)))) {
          if (score > (scores.get(key)?.score ?? -1)) scores.set(key, { score, matchedAlias: candidate.alias });
        }
      }
    }
    return [...scores].map(([key, s]) => ({ ...groups.get(key)!, ...s })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
  }
  function exact(query: string, spec: string) {
    const name = normalizeName(query), s = normalizeSpecification(spec);
    let candidates = rows.filter(r => normalizeName(r.name) === name);
    if (!candidates.length) candidates = rows.filter(r => r.aliases.some(a => a.normalizedAlias === name));
    const keys = [...new Set(candidates.map(r => materialGroupKey(r.name, productSpecification(r.spec, r.unit))))];
    const eligible = keys.map(k => groups.get(k)!).filter(g => !s || normalizeSpecification(g.spec) === s);
    return eligible.length === 1 ? eligible[0] : null;
  }
  return { groups, search, exact, rows };
}
