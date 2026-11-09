import type { Db } from "@/lib/prisma";
import { createNameScorer, matchLabel, scoreName } from "@/lib/text";

export type SupplierSuggestion = {
  id: string;
  name: string;
  score: number;
  confidence: number;
  matchStatus: "MATCHED" | "SIMILAR" | "NEW";
  exact: boolean;
  matchedAlias?: string;
  contactName?: string;
  contactPhone?: string;
};

export type IngredientSuggestion = {
  id: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  score: number;
  confidence: number;
  matchStatus: "MATCHED" | "SIMILAR" | "NEW";
  exact: boolean;
  matchedAlias?: string;
};

export async function suggestSuppliers(
  db: Db,
  query: string,
  limit = 3,
): Promise<SupplierSuggestion[]> {
  const suppliers = await db.supplier.findMany({
    where: { active: true },
    include: { aliases: true },
  });

  return suppliers
    .map((supplier) => {
      const candidates = [
        { value: supplier.name, alias: undefined as string | undefined },
        ...supplier.aliases.map((alias) => ({
          value: alias.alias,
          alias: alias.alias,
        })),
      ];
      const best = candidates
        .map((candidate) => ({
          ...scoreName(query, candidate.value),
          alias: candidate.alias,
        }))
        .sort((left, right) => right.score - left.score)[0];
      return {
        id: supplier.id,
        name: supplier.name,
        score: best?.score || 0,
        confidence: best?.score || 0,
        matchStatus: matchLabel(best?.score || 0, best?.exact || false),
        exact: best?.exact || false,
        matchedAlias: best?.alias,
        contactName: supplier.contactName,
        contactPhone: supplier.contactPhone,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function suggestIngredients(
  db: Db,
  query: string,
  limit = 3,
): Promise<IngredientSuggestion[]> {
  const suggest = await createIngredientMatcher(db);
  return suggest(query, limit);
}

// One catalogue snapshot per OCR document, shared across all lines.
export async function createIngredientMatcher(db: Db) {
  const ingredients = await db.ingredient.findMany({
    where: { active: true },
    include: { aliases: true },
  });

  const score = createNameScorer();
  return (query: string, limit = 3): IngredientSuggestion[] => ingredients
    .map((ingredient) => {
      const candidates = [
        { value: ingredient.name, alias: undefined as string | undefined },
        ...ingredient.aliases.map((alias) => ({
          value: alias.alias,
          alias: alias.alias,
        })),
      ];
      const best = candidates
        .map((candidate) => ({
          ...score(query, candidate.value),
          alias: candidate.alias,
        }))
        .sort((left, right) => right.score - left.score)[0];
      return {
        id: ingredient.id,
        name: ingredient.name,
        spec: ingredient.spec,
        unit: ingredient.unit,
        category: ingredient.category,
        score: best?.score || 0,
        confidence: best?.score || 0,
        matchStatus: matchLabel(best?.score || 0, best?.exact || false),
        exact: best?.exact || false,
        matchedAlias: best?.alias,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function bestSupplierMatch(db: Db, query: string) {
  return (await suggestSuppliers(db, query, 1))[0] || null;
}

export async function bestIngredientMatch(db: Db, query: string) {
  return (await suggestIngredients(db, query, 1))[0] || null;
}
