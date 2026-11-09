import { hasPermission, permissionProjectIds } from "@/lib/permissions";
import { documentReadScope } from "./read-scope";
import type { Prisma } from "@/generated/prisma/client";
import { getReadyDb } from "@/lib/bootstrap";
import { dateOnly, parseDateOnly, roundMoney } from "@/lib/text";
import { allowedProjectIds, ApiError, type SessionUser } from "./auth";
import { listDocuments } from "./document-service";

function projectScope(user: SessionUser): Prisma.DocumentWhereInput {
  return documentReadScope(user);
}

function monthKeys(count = 6) {
  const result: string[] = [];
  const now = new Date();
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1),
    );
    result.push(date.toISOString().slice(0, 7));
  }
  return result;
}

export async function getDashboard(user: SessionUser) {
  const db = await getReadyDb();
  const scope = projectScope(user);
  const [documents, openChecks, recent, priority] = await Promise.all([
    db.document.findMany({
      where: scope,
      include: { items: { select: { confidence: true } } },
    }),
    db.checkResult.findMany({
      where: { status: "OPEN", document: scope },
      select: { severity: true, dimension: true },
    }),
    listDocuments(user, { limit: 6 }),
    Promise.all(["NEEDS_REVISION", "PENDING_REVIEW", "DRAFT"].map(status => listDocuments(user, { status, limit: 4 }))),
  ]);
  const month = dateOnly(new Date()).slice(0, 7);
  const approved = documents.filter((document) => document.status === "APPROVED");
  const visibleAmounts=approved.filter(document=>hasPermission(user,"document.view_amount",document.projectId));
  const monthSpend = visibleAmounts
    .filter((document) => dateOnly(document.docDate).slice(0, 7) === month)
    .reduce((sum, document) => sum + Number(document.totalAmount), 0);
  const confidenceValues = documents.flatMap((document) =>
    document.items.map((item) => item.confidence).filter((value) => value > 0),
  );
  const riskMap = new Map<string, number>();
  for (const check of openChecks) {
    if (check.severity === "INFO") continue;
    riskMap.set(check.dimension, (riskMap.get(check.dimension) || 0) + 1);
  }
  const keys = monthKeys();
  const trend = keys.map((key) => ({
    month: key,
    amount: roundMoney(
      visibleAmounts
        .filter((document) => dateOnly(document.docDate).startsWith(key))
        .reduce((sum, document) => sum + Number(document.totalAmount), 0),
    ),
  }));
  const projectRows = await db.project.findMany({
    where: {
      active: true,
      ...(allowedProjectIds(user)
        ? { id: { in: allowedProjectIds(user)! } }
        : {}),
    },
    include: {
      documents: {
        where: { status: "APPROVED",AND:[scope] },
        select: { totalAmount: true },
      },
    },
    orderBy: { code: "asc" },
  });
  return {
    user,
    counters: {
      total: documents.length,
      pendingReview: documents.filter((document) => document.status === "PENDING_REVIEW").length,
      needsRevision: documents.filter((document) => document.status === "NEEDS_REVISION").length,
      draft: documents.filter((document) => document.status === "DRAFT").length,
      approved: approved.length,
      openErrors: openChecks.filter((check) => check.severity === "ERROR").length,
      openWarnings: openChecks.filter((check) => check.severity === "WARNING").length,
      monthSpend: hasPermission(user,"document.view_amount")?roundMoney(monthSpend):null,
      avgConfidence: confidenceValues.length
        ? confidenceValues.reduce((sum, value) => sum + value, 0) /
          confidenceValues.length
        : 0,
    },
    recent,
    priority: priority.flat().slice(0, 8),
    risks: Array.from(riskMap, ([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 8),
    trend:hasPermission(user,"document.view_amount")?trend:[],
    projectSpend: projectRows.filter(project=>hasPermission(user,"document.view_amount",project.id)).map((project) => ({
      name: project.name,
      amount: roundMoney(
        project.documents.reduce(
          (sum, document) => sum + Number(document.totalAmount),
          0,
        ),
      ),
    })),
  };
}

export async function getAnalytics(
  user: SessionUser,
  filters: { from?: string; to?: string; projectId?: string },
) {
  if (!hasPermission(user,"analytics.view")) throw new ApiError(403,"当前角色没有价格分析权限");
  const db = await getReadyDb();
  const from = parseDateOnly(filters.from || "");
  const to = parseDateOnly(filters.to || "");
  if (filters.from && !from) throw new ApiError(400, "开始日期无效");
  if (filters.to && !to) throw new ApiError(400, "结束日期无效");
  if (from && to && from > to) throw new ApiError(400, "日期区间无效");
  const start =
    from ||
    (() => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - 90);
      return date;
    })();
  const end = to
    ? new Date(to.getTime() + 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  const projectIds = permissionProjectIds(user,"analytics.view");
  const where: Prisma.DocumentWhereInput = {
    AND:[documentReadScope(user)],
    ...(projectIds ? {projectId:{in:projectIds}} : {}),
    status: "APPROVED",
    docDate: { gte: start, lt: end },
  };
  if (filters.projectId) {
    if (projectIds && !projectIds.includes(filters.projectId)) {
      throw new ApiError(403, "无权查看该项目点");
    }
    where.projectId = filters.projectId;
  }

  const [documents, projects, checks] = await Promise.all([
    db.document.findMany({
      where,
      include: {
        project: true,
        supplier: true,
        items: { include: { ingredient: true } },
      },
      orderBy: { docDate: "desc" },
    }),
    db.project.findMany({
      where: {
        active: true,
        ...(projectIds ? { id: { in: projectIds } } : {}),
      },
      orderBy: { code: "asc" },
    }),
    db.checkResult.findMany({
      where: {
        status: "OPEN",
        document: {
          AND:[documentReadScope(user)],
          ...(projectIds ? {projectId:{in:projectIds}} : {}),
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
        },
      },
    }),
  ]);

  const supplierMap = new Map<string, { name: string; amount: number; docs: number }>();
  const projectSpendMap = new Map<string, { name: string; amount: number; docs: number }>();
  const productGroup = new Map<
    string,
    {
      ingredientId: string;
      name: string;
      spec: string;
      unit: string;
      prices: number[];
      projects: Set<string>;
      suppliers: Set<string>;
    }
  >();
  const matrixGroup = new Map<
    string,
    {
      ingredientId: string;
      ingredient: string;
      spec: string;
      unit: string;
      projects: Map<string, number[]>;
      suppliers: Map<string, number[]>;
    }
  >();

  for (const document of documents) {
    const supplierName = document.supplier?.name || "未确认供应商";
    if(hasPermission(user,"document.view_amount",document.projectId)) {
    const supplier = supplierMap.get(supplierName) || {
      name: supplierName,
      amount: 0,
      docs: 0,
    };
    supplier.amount += Number(document.totalAmount);
    supplier.docs += 1;
    supplierMap.set(supplierName, supplier);

    const project = projectSpendMap.get(document.projectId) || {
      name: document.project.name,
      amount: 0,
      docs: 0,
    };
    project.amount += Number(document.totalAmount);
    project.docs += 1;
    projectSpendMap.set(document.projectId, project);
    }

    for (const item of document.items) {
      if (!hasPermission(user,"document.view_unit_price",document.projectId)) continue;
      if (!item.ingredientId || !item.ingredient) continue;
      const key = `${item.ingredientId}|${item.spec}|${item.unit}`;
      const price = Number(item.unitPrice);
      if (!(price > 0)) continue;
      const product = productGroup.get(key) || {
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        spec: item.spec,
        unit: item.unit,
        prices: [],
        projects: new Set<string>(),
        suppliers: new Set<string>(),
      };
      product.prices.push(price);
      product.projects.add(document.project.name);
      product.suppliers.add(supplierName);
      productGroup.set(key, product);

      const matrix = matrixGroup.get(key) || {
        ingredientId: item.ingredientId,
        ingredient: item.ingredient.name,
        spec: item.spec,
        unit: item.unit,
        projects: new Map<string, number[]>(),
        suppliers: new Map<string, number[]>(),
      };
      matrix.projects.set(document.projectId, [
        ...(matrix.projects.get(document.projectId) || []),
        price,
      ]);
      matrix.suppliers.set(supplierName, [
        ...(matrix.suppliers.get(supplierName) || []),
        price,
      ]);
      matrixGroup.set(key, matrix);
    }
  }

  const products = Array.from(productGroup.values())
    .map((product) => {
      const min = Math.min(...product.prices);
      const max = Math.max(...product.prices);
      return {
        ingredientId: product.ingredientId,
        name: product.name,
        spec: product.spec,
        unit: product.unit,
        lines: product.prices.length,
        avgPrice: roundMoney(
          product.prices.reduce((sum, value) => sum + value, 0) /
            product.prices.length,
        ),
        minPrice: roundMoney(min),
        maxPrice: roundMoney(max),
        spread: roundMoney(max - min),
        projectCount: product.projects.size,
        supplierCount: product.suppliers.size,
      };
    })
    .sort((left, right) => right.spread - left.spread);

  const priceMatrix = Array.from(matrixGroup.values())
    .map((matrix) => ({
      ingredientId: matrix.ingredientId,
      ingredient: matrix.ingredient,
      spec: matrix.spec,
      unit: matrix.unit,
      projects: Object.fromEntries(
        Array.from(matrix.projects, ([name, prices]) => [
          name,
          roundMoney(prices.reduce((sum, value) => sum + value, 0) / prices.length),
        ]),
      ),
      samples: Object.fromEntries(Array.from(matrix.projects, ([id, prices]) => [id, prices.length])),
      suppliers: Object.fromEntries(
        Array.from(matrix.suppliers, ([name, prices]) => [
          name,
          {
            avgPrice: roundMoney(
              prices.reduce((sum, value) => sum + value, 0) / prices.length,
            ),
            minPrice: roundMoney(Math.min(...prices)),
            maxPrice: roundMoney(Math.max(...prices)),
            samples: prices.length,
          },
        ]),
      ),
    }))
    .sort((left, right) => left.ingredient.localeCompare(right.ingredient, "zh"));

  const dimensionMap = new Map<string, { name: string; value: number; severity: string }>();
  for (const check of checks) {
    const current = dimensionMap.get(check.dimension);
    if (current) {
      current.value += 1;
      if (check.severity === "ERROR") current.severity = "ERROR";
    } else {
      dimensionMap.set(check.dimension, {
        name: check.dimension,
        value: 1,
        severity: check.severity,
      });
    }
  }

  return {
    visibility:{unitPrice:hasPermission(user,"document.view_unit_price",filters.projectId),amount:hasPermission(user,"document.view_amount",filters.projectId)},
    range: { from: dateOnly(start), to: dateOnly(end) },
    projects: projects.map((project) => ({ id: project.id, name: project.name, unitPrice: hasPermission(user,"document.view_unit_price",project.id) })),
    priceMatrix,
    products,
    dimensions: Array.from(dimensionMap.values()).sort(
      (left, right) => right.value - left.value,
    ),
    supplierSpend: Array.from(supplierMap.values())
      .map((supplier) => ({ ...supplier, amount: roundMoney(supplier.amount) }))
      .sort((left, right) => right.amount - left.amount),
    projectSpend: Array.from(projectSpendMap.values())
      .map((project) => ({ ...project, amount: roundMoney(project.amount) }))
      .sort((left, right) => right.amount - left.amount),
  };
}
