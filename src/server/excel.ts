import { assertCategoryActive } from "./ingredient-maintenance";
import { importSheets, type MasterImportType } from "@/lib/master-import";
import { hasPermission, permissionProjectIds, documentVisibility } from "@/lib/permissions";
import { documentReadScope, canViewCheckDetails } from "./read-scope";
import ExcelJS from "exceljs";
import path from "node:path";
import { DocumentStatus } from "@/generated/prisma/enums";
import { getReadyDb } from "@/lib/bootstrap";
import { dateOnly, normalizeName, normalizeUnit, parseDateOnly, roundMoney } from "@/lib/text";
import { allowedProjectIds, ApiError, isAdmin, type SessionUser } from "./auth";

type ImportError = { sheet: string; row: number; message: string };

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return dateOnly(value);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result !== undefined) {
      return String(value.result);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    return "";
  }
  return String(value).trim();
}

function readSheet(workbook: ExcelJS.Workbook, name: string) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) return { rows: [] as Record<string, string>[], missing: true };
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, column) => {
    headers[column] = cellText(cell.value);
  });
  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, column) => {
      if (!header) return;
      const value = cellText(row.getCell(column).value);
      if (value) hasValue = true;
      data[header] = value;
    });
    if (hasValue) rows.push({ ...data, __row: String(rowNumber) });
  });
  return { rows, missing: false };
}

type IngredientCandidate = {
  normalizedName: string;
  normalizedSpec: string;
  unit: string;
  normalizedAliases: string[];
};

type IngredientResolution =
  | { ok: true; candidate: IngredientCandidate }
  | { ok: false; message: string };

function resolveIngredientCandidate(
  candidates: IngredientCandidate[],
  normalizedName: string,
  normalizedSpec: string,
  unit: string,
): IngredientResolution {
  const nameMatched = new Map<string, IngredientCandidate>();
  const aliasMatched = new Map<string, IngredientCandidate>();
  for (const candidate of candidates) {
    if (candidate.unit !== unit) continue;
    if (normalizedSpec && candidate.normalizedSpec !== normalizedSpec) continue;
    const key = `${candidate.normalizedName}|${candidate.normalizedSpec}|${candidate.unit}`;
    if (candidate.normalizedName === normalizedName) {
      nameMatched.set(key, candidate);
    }
    if (candidate.normalizedAliases.includes(normalizedName)) {
      aliasMatched.set(key, candidate);
    }
  }
  const unique = Array.from(
    (nameMatched.size ? nameMatched : aliasMatched).values(),
  );
  if (unique.length === 1) return { ok: true, candidate: unique[0] };
  if (unique.length === 0) {
    return {
      ok: false,
      message: normalizedSpec
        ? "原材料不存在，或规格、单位不匹配"
        : "原材料不存在，请先在原材料工作表声明或导入主数据",
    };
  }
  return {
    ok: false,
    message: "无法唯一定位原材料，请在合同价工作表填写规格",
  };
}

export async function buildMasterTemplate(type: MasterImportType = "all"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "食安链";
  workbook.created = new Date();

  const addSheet = (name: string, headers: string[], widths: number[]) => {
    if (type !== "all" && name !== importSheets[type]) return;
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF173F35" },
    };
    sheet.getRow(1).height = 24;
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    headers.forEach((_, index) => {
      sheet.getColumn(index + 1).width = widths[index] || 18;
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };
    return sheet;
  };

  addSheet(
    "供应商",
    ["名称", "联系人", "联系电话", "别名"],
    [34, 14, 18, 34],
  );
  addSheet(
    "原材料",
    ["品名", "规格", "单位", "分类", "别名", "备注"],
    [20, 18, 10, 16, 38, 40],
  );
  addSheet(
    "项目合同价",
    ["项目点编码", "供应商名称", "品名", "规格", "单位", "单价", "生效日期", "截止日期"],
    [16, 34, 20, 18, 10, 12, 14, 14],
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function importMasterWorkbook(
  user: SessionUser,
  buffer: Buffer,
  dryRun: boolean,
  type: MasterImportType = "all",
) {
  if (!hasPermission(user,"master.import")) throw new ApiError(403, "当前角色没有导入主数据权限");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ApiError(400, "Excel 文件无法解析，请使用系统模板");
  }
  const errors: ImportError[] = [];
  const requiredHeaders: Record<string, string[]> = {
    "供应商": ["名称"], "原材料": ["品名", "单位"],
    "项目合同价": ["项目点编码", "供应商名称", "品名", "单位", "单价", "生效日期"],
  };
  const selectedSheets = type === "all" ? Object.keys(requiredHeaders) : [importSheets[type]];
  for (const name of selectedSheets) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) { errors.push({sheet: name, row: 1, message: `请选择${name}模板，缺少“${name}”工作表`}); continue; }
    const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
    for (const header of requiredHeaders[name]) {
      if (!headers.some(value => cellText(value) === header)) errors.push({sheet: name, row: 1, message: `缺少“${header}”列，请下载对应模板`});
    }
  }
  if (type !== "all") {
    for (const sheet of workbook.worksheets) {
      if (sheet.name !== importSheets[type] && readSheet(workbook, sheet.name).rows.length) {
        errors.push({sheet: sheet.name, row: 1, message: "文件含其他类型数据，请核对导入类型或选择综合导入"});
      }
    }
  }
  const empty = { rows: [] as Record<string, string>[], missing: false };
  const suppliers = selectedSheets.includes("供应商") ? readSheet(workbook, "供应商") : empty;
  const ingredients = selectedSheets.includes("原材料") ? readSheet(workbook, "原材料") : empty;
  const contracts = selectedSheets.includes("项目合同价") ? readSheet(workbook, "项目合同价") : empty;
  if (!suppliers.rows.length && !ingredients.rows.length && !contracts.rows.length) errors.push({sheet: selectedSheets[0], row: 2, message: "没有可导入的数据，请从第二行填写"});
  if (errors.length) return {dryRun, errors, summary: null};

  const db = await getReadyDb();
  const importProjects = permissionProjectIds(user,"master.import");
  const projects = await db.project.findMany({where:{active:true,...(importProjects ? {id:{in:importProjects}} : {})}});
  const projectByCode = new Map(projects.map((project) => [project.code, project]));
  const declaredIngredients: IngredientCandidate[] = [];
  const categorySetting = await db.systemSetting.findUnique({where: {key: "ingredient.categories"}});
  const disabledCategories = ((categorySetting?.value || []) as {name: string; active: boolean}[]).filter(item => !item.active).map(item => item.name);

  for (const [index, row] of suppliers.rows.entries()) {
    const name = row["名称"]?.trim();
    if (!name) {
      errors.push({ sheet: "供应商", row: Number(row.__row || index + 2), message: "名称不能为空" });
      continue;
    }
  }
  for (const [index, row] of ingredients.rows.entries()) {
    const name = row["品名"]?.trim();
    const unit = normalizeUnit(row["单位"] || "");
    if (!name || !unit) {
      errors.push({
        sheet: "原材料",
        row: Number(row.__row || index + 2),
        message: "品名和单位不能为空",
      });
      continue;
    }
    if (disabledCategories.includes(row["分类"]?.trim() || "")) errors.push({sheet: "原材料", row: Number(row.__row || index + 2), message: "分类已停用，请使用启用的分类"});
    const spec = row["规格"]?.trim() || "";
    const aliases = (row["别名"] || "")
      .split(/[|、,，]/)
      .map((value) => value.trim())
      .filter(Boolean);
    declaredIngredients.push({
      normalizedName: normalizeName(name),
      normalizedSpec: normalizeName(spec),
      unit,
      normalizedAliases: aliases.map((alias) => normalizeName(alias)),
    });
  }

  const contractIngredientNames = Array.from(
    new Set(
      contracts.rows
        .map((row) => normalizeName(row["品名"] || ""))
        .filter(Boolean),
    ),
  );
  const existingIngredients = await db.ingredient.findMany({
    where: {
      active: true,
      OR: [
        { normalizedName: { in: contractIngredientNames } },
        {
          aliases: {
            some: { normalizedAlias: { in: contractIngredientNames } },
          },
        },
      ],
    },
    include: { aliases: true },
  });
  const ingredientCandidates: IngredientCandidate[] = [
    ...declaredIngredients,
    ...existingIngredients.map((ingredient) => ({
      normalizedName: ingredient.normalizedName,
      normalizedSpec: ingredient.normalizedSpec,
      unit: ingredient.unit,
      normalizedAliases: ingredient.aliases.map(
        (alias) => alias.normalizedAlias,
      ),
    })),
  ];
  const resolvedIngredients = new Map<number, IngredientCandidate>();

  for (const [index, row] of contracts.rows.entries()) {
    const rowNumber = Number(row.__row || index + 2);
    const project = projectByCode.get(row["项目点编码"]?.trim());
    const supplierName = row["供应商名称"]?.trim();
    const ingredientName = row["品名"]?.trim();
    const unit = normalizeUnit(row["单位"] || "");
    const price = Number(row["单价"]);
    const startsOn = parseDateOnly(row["生效日期"]);
    const endsOn = row["截止日期"] ? parseDateOnly(row["截止日期"]) : null;
    if (!project) {
      errors.push({ sheet: "项目合同价", row: rowNumber, message: "项目点编码不存在" });
    }
    if (!supplierName) {
      errors.push({ sheet: "项目合同价", row: rowNumber, message: "供应商名称不能为空" });
    }
    if (!ingredientName || !unit) {
      errors.push({ sheet: "项目合同价", row: rowNumber, message: "品名和单位不能为空" });
    } else {
      const resolution = resolveIngredientCandidate(
        ingredientCandidates,
        normalizeName(ingredientName),
        normalizeName(row["规格"] || ""),
        unit,
      );
      if (resolution.ok) {
        resolvedIngredients.set(rowNumber, resolution.candidate);
      } else {
        errors.push({
          sheet: "项目合同价",
          row: rowNumber,
          message: resolution.message,
        });
      }
    }
    if (!Number.isFinite(price) || !(price > 0) || price >= 10_000_000_000) {
      errors.push({ sheet: "项目合同价", row: rowNumber, message: "单价必须大于 0 且小于 100 亿" });
    }
    if (!startsOn) {
      errors.push({ sheet: "项目合同价", row: rowNumber, message: "生效日期格式无效" });
    }
    if (row["截止日期"] && !endsOn) {
      errors.push({ sheet: "项目合同价", row: rowNumber, message: "截止日期格式无效" });
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      errors.push({ sheet: "项目合同价", row: rowNumber, message: "截止日期早于生效日期" });
    }
  }

  if (errors.length) {
    return { dryRun, errors, summary: null };
  }

  if (dryRun) {
    return {
      dryRun,
      errors: [],
      summary: {
        suppliers: suppliers.rows.length,
        ingredients: ingredients.rows.length,
        contracts: contracts.rows.length,
        message: "校验通过，尚未写入数据库",
      },
    };
  }

  let importBatchId = "";
  await db.$transaction(async (tx) => {
    if (!hasPermission(user,"master.import")) throw new ApiError(403, "当前角色没有导入主数据权限");
    for (const row of suppliers.rows) {
      const name = row["名称"].trim();
      const normalizedName = normalizeName(name);
      const existing = await tx.supplier.findFirst({
        where: {
          OR: [{ normalizedName }, { aliases: { some: { normalizedAlias: normalizedName } } }],
          active: true,
        },
      });
      if (!existing) {
        const inactive = await tx.supplier.findFirst({
          where: { normalizedName, active: false },
        });
        if (inactive) {
          throw new ApiError(
            400,
            `供应商“${name}”已停用（可能已合并），请使用合并后的目标供应商`,
          );
        }
      }
      const supplier = existing
        ? await tx.supplier.update({
            where: { id: existing.id },
            data: {
              contactName: row["联系人"] || existing.contactName,
              contactPhone: row["联系电话"] || existing.contactPhone,
            },
          })
        : await tx.supplier.create({
            data: {
              name,
              normalizedName,
              contactName: row["联系人"] || "",
              contactPhone: row["联系电话"] || "",
              createdById: user.id,
            },
          });
      for (const alias of (row["别名"] || "").split(/[|、,，]/).map((value) => value.trim()).filter(Boolean)) {
        await tx.supplierAlias.upsert({
          where: {
            supplierId_normalizedAlias: {
              supplierId: supplier.id,
              normalizedAlias: normalizeName(alias),
            },
          },
          update: {},
          create: {
            supplierId: supplier.id,
            alias,
            normalizedAlias: normalizeName(alias),
          },
        });
      }
    }

    for (const row of ingredients.rows) {
      await assertCategoryActive(tx, row["分类"]?.trim() || "");
      const name = row["品名"].trim();
      const spec = row["规格"]?.trim() || "";
      const unit = normalizeUnit(row["单位"]);
      const normalizedName = normalizeName(name);
      const normalizedSpec = normalizeName(spec);
      const existing = await tx.ingredient.findUnique({
        where: {
          normalizedName_normalizedSpec_unit: {
            normalizedName,
            normalizedSpec,
            unit,
          },
        },
      });
      if (existing && !existing.active) {
        throw new ApiError(
          400,
          `原材料“${name}”已停用（可能已合并），请使用合并后的目标材料`,
        );
      }
      const ingredient = existing
        ? await tx.ingredient.update({
            where: { id: existing.id },
            data: { category: row["分类"] || existing.category,
              ...(row["备注"]===undefined?{}:{notes:row["备注"]}),version:{increment:1} },
          })
        : await tx.ingredient.create({
            data: {
              name,
              normalizedName,
              spec,
              normalizedSpec,
              unit,
              category: row["分类"] || "",
              notes: row["备注"] || "",
              createdById: user.id,
            },
          });
      for (const alias of (row["别名"] || "").split(/[|、,，]/).map((value) => value.trim()).filter(Boolean)) {
        await tx.ingredientAlias.upsert({
          where: {
            ingredientId_normalizedAlias: {
              ingredientId: ingredient.id,
              normalizedAlias: normalizeName(alias),
            },
          },
          update: {},
          create: {
            ingredientId: ingredient.id,
            alias,
            normalizedAlias: normalizeName(alias),
          },
        });
      }
    }

    for (const [index, row] of contracts.rows.entries()) {
      const resolved = resolvedIngredients.get(
        Number(row.__row || index + 2),
      );
      if (!resolved) throw new ApiError(400, "合同价引用的原材料未能导入");
      const project = projectByCode.get(row["项目点编码"].trim())!;
      const supplierNormalized = normalizeName(row["供应商名称"]);
      const unit = normalizeUnit(row["单位"]);
      const supplier = await tx.supplier.findFirst({
        where: {
          OR: [
            { normalizedName: supplierNormalized },
            { aliases: { some: { normalizedAlias: supplierNormalized } } },
          ],
          active: true,
        },
      });
      const ingredient = await tx.ingredient.findUnique({
        where: {
          normalizedName_normalizedSpec_unit: {
            normalizedName: resolved.normalizedName,
            normalizedSpec: resolved.normalizedSpec,
            unit: resolved.unit,
          },
        },
      });
      if (!supplier || !ingredient) {
        throw new ApiError(400, "合同价引用的供应商或原材料未能导入");
      }
      if (!ingredient.active) {
        throw new ApiError(
          400,
          "合同价引用的原材料已停用，请使用合并后的目标材料",
        );
      }
      const startsOn = parseDateOnly(row["生效日期"])!;
      const endsOn = row["截止日期"] ? parseDateOnly(row["截止日期"]) : null;
      const spec = ingredient.spec;
      const existing = await tx.contract.findFirst({
        where: {
          projectId: project.id,
          supplierId: supplier.id,
          ingredientId: ingredient.id,
          spec,
          unit,
          startsOn,
        },
      });
      if (existing) {
        await tx.contract.update({
          where: { id: existing.id },
          data: { unitPrice: Number(row["单价"]), endsOn },
        });
      } else {
        await tx.contract.create({
          data: {
            projectId: project.id,
            supplierId: supplier.id,
            ingredientId: ingredient.id,
            spec,
            unit,
            unitPrice: Number(row["单价"]),
            startsOn,
            endsOn,
            createdById: user.id,
          },
        });
      }
    }
    const batch = await tx.importBatch.create({
      data: {
        userId: user.id,
        fileName: "master-data.xlsx",
        status: "IMPORTED",
        summary: {
          suppliers: suppliers.rows.length,
          ingredients: ingredients.rows.length,
          contracts: contracts.rows.length,
        },
      },
    });
    importBatchId = batch.id;
  });

  return {
    dryRun,
    errors: [],
    importBatchId,
    summary: {
      suppliers: suppliers.rows.length,
      ingredients: ingredients.rows.length,
      contracts: contracts.rows.length,
    },
  };
}

export async function buildDocumentsWorkbook(
  user: SessionUser,
  filters: { from?: string; to?: string; projectId?: string; status?: string },
) {
  const db = await getReadyDb();
  if (!hasPermission(user,"document.export")) throw new ApiError(403,"当前角色没有导出权限");
  const allowed = permissionProjectIds(user,"document.export");
  const requestedProjectId = filters.projectId?.trim() || "";
  if (requestedProjectId && allowed && !allowed.includes(requestedProjectId)) {
    throw new ApiError(403, "无权导出该项目点的单据");
  }
  const projectIds = requestedProjectId ? [requestedProjectId] : allowed;
  const status = filters.status?.trim() || "";
  if (
    status &&
    !Object.values(DocumentStatus).includes(status as DocumentStatus)
  ) {
    throw new ApiError(400, "单据状态无效");
  }
  const from = filters.from ? parseDateOnly(filters.from) : null;
  const to = filters.to ? parseDateOnly(filters.to) : null;
  if (filters.from && !from) throw new ApiError(400, "开始日期无效");
  if (filters.to && !to) throw new ApiError(400, "结束日期无效");
  if (from && to && from > to) throw new ApiError(400, "日期区间无效");
  const documents = await db.document.findMany({
    where: {
      AND:[documentReadScope(user)],
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
      ...(status ? { status: status as DocumentStatus } : {}),
      ...(from || to
        ? {
            docDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
    },
    include: {
      project: true,
      supplier: true,
      items: { include: { ingredient: true } },
      checks: true,
    },
    orderBy: { docDate: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "食安链";
  const summary = workbook.addWorksheet("单据汇总");
  summary.addRow([
    "单据日期",
    "单号",
    "项目点",
    "供应商",
    "状态",
    "明细数",
    "单据总价",
    "严重异常",
    "提醒",
  ]);
  const items = workbook.addWorksheet("单据明细");
  items.addRow([
    "单据日期",
    "单号",
    "项目点",
    "供应商",
    "品名",
    "规格",
    "单位",
    "数量",
    "单价",
    "行金额",
    "识别置信度",
  ]);
  const checks = workbook.addWorksheet("异常结果");
  checks.addRow([
    "单据日期",
    "单号",
    "项目点",
    "维度",
    "级别",
    "标题",
    "说明",
    "期望值",
    "实际值",
  ]);
  for (const document of documents) {
    const visibility=documentVisibility(user,document.projectId);
    summary.addRow([
      dateOnly(document.docDate),
      document.docNo,
      document.project.name,
      document.supplier?.name || document.ocrSupplierName,
      document.status,
      document.items.length,
      visibility.amount?Number(document.totalAmount):"未授权",
      document.checks.filter((check) => check.severity === "ERROR").length,
      document.checks.filter((check) => check.severity === "WARNING").length,
    ]);
    for (const item of document.items) {
      items.addRow([
        dateOnly(document.docDate),
        document.docNo,
        document.project.name,
        document.supplier?.name || document.ocrSupplierName,
        item.name,
        item.spec,
        item.unit,
        Number(item.quantity),
        visibility.unitPrice?Number(item.unitPrice):"未授权",
        visibility.amount?Number(item.amount):"未授权",
        item.confidence,
      ]);
    }
    for (const check of document.checks) {
      const details=canViewCheckDetails(user,document.projectId,check.type);
      checks.addRow([
        dateOnly(document.docDate),
        document.docNo,
        document.project.name,
        check.dimension,
        check.severity,
        check.title,
        details?check.detail:"详细核对依据已按查看权限隐藏",
        !details || check.expectedValue === null ? "" : Number(check.expectedValue),
        !details || check.actualValue === null ? "" : Number(check.actualValue),
      ]);
    }
  }
  for (const sheet of [summary, items, checks]) {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF173F35" },
    };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };
  }
  summary.getColumn(7).numFmt = "¥#,##0.00";
  items.getColumn(9).numFmt = "¥#,##0.00";
  items.getColumn(10).numFmt = "¥#,##0.00";
  items.getColumn(11).numFmt = "0.0%";
  summary.columns.forEach((column) => (column.width = 18));
  items.columns.forEach((column) => (column.width = 16));
  checks.columns.forEach((column, index) => (column.width = index === 6 ? 50 : 18));
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    fileName: `送货单导出-${dateOnly(new Date())}.xlsx`,
  };
}
