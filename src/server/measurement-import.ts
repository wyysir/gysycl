import type { Db } from "@/lib/prisma";
import { normalizeName, normalizeSpecification, productSpecification, normalizeUnit } from "@/lib/text";
import { hasPermission } from "@/lib/permissions";
import { measurementUnit, simpleSpecificationQuantity, standardUnitRatio } from "@/lib/measurement-units";
import { measurementSchema, type MeasurementInput } from "./measurements";
import type { SessionUser } from "./auth";

export const measurementImportHeaders = ["商品名称", "商品规格", "采购单位", "分类", "别名", "备注", "统计原材料", "统计单位", "商品基准单位", "基准单位折合统计数量", "采购单位倍数", "换算确认"];
export function importHeader(header: string) {
  return ({ 商品名称: "品名", 商品规格: "规格", 采购单位: "单位" } as Record<string, string>)[header] || header;
}
type Error = { sheet: string; row: number; message: string };
type Row = Record<string, string>;
export async function compileMeasurementImports(db: Db, user: SessionUser, rows: Row[]) {
  const errors: Error[] = [], configs = new Map<number, MeasurementInput>();
  const declarations = new Map<string, { materialUnit: string; productUnit: string; baseQuantity: number | null; rows: Row[] }>();
  const materials = await db.materialIdentity.findMany({ include: { products: true } });
  for (const row of rows) {
    const name = row["统计原材料"]?.trim() || "", rowNumber = Number(row.__row);
    const any = ["统计单位", "商品基准单位", "基准单位折合统计数量", "采购单位倍数", "换算确认"].some(k => row[k]?.trim());
    if (!name && !any) continue;
    const error = (message: string) => errors.push({ sheet: "原材料", row: rowNumber, message });
    if (!name) { error("填写换算字段时，统计原材料名称不能为空"); continue; }
    if (!hasPermission(user, "master.manage")) { error("当前角色没有原材料归并与换算维护权限"); continue; }
    const existing = materials.find(m => m.normalizedName === normalizeName(name));
    const p = existing?.products.find(p => p.normalizedName === normalizeName(row["品名"] || "") && p.normalizedSpec === normalizeSpecification(productSpecification(row["规格"] || "", row["单位"] || "")));
    const mu = measurementUnit(row["统计单位"] || existing?.baseUnit || ""), pu = measurementUnit(row["商品基准单位"] || p?.baseUnit || "");
    if (existing?.baseUnit && existing.baseUnit !== mu) error(`该原材料已有统计单位${existing.baseUnit}，不能混用${mu}`);
    if (p?.baseUnit && p.baseUnit !== pu) error(`该商品规格已有基准单位${p.baseUnit}，不能混用${pu}`);
    const confirmed = ["是", "已确认", "确认", "true", "1"].includes((row["换算确认"] || "").trim().toLowerCase());
    if (row["换算确认"] && !confirmed && !["否", "待确认", "false", "0"].includes(row["换算确认"].trim().toLowerCase())) error("换算确认请填是、否或待确认");
    if (!confirmed && (row["基准单位折合统计数量"]?.trim() || row["采购单位倍数"]?.trim())) error("换算数尚未确认，请清空数值并标记待确认，或核对后填写是");
    let base = confirmed && row["基准单位折合统计数量"]?.trim() ? Number(row["基准单位折合统计数量"]) : p?.baseQuantity === null || p?.baseQuantity === undefined ? null : Number(p.baseQuantity);
    let multiple = confirmed && row["采购单位倍数"]?.trim() ? Number(row["采购单位倍数"]) : null;
    const standardBase = standardUnitRatio(pu, mu), standardMultiple = standardUnitRatio(normalizeUnit(row["单位"] || ""), pu);
    if (confirmed && row["基准单位折合统计数量"]?.trim() && (base === null || !Number.isFinite(base) || standardBase !== null && Math.abs(base - standardBase) > 1e-10)) error("基准单位折算数量与标准单位换算不符");
    if (confirmed && row["采购单位倍数"]?.trim() && (multiple === null || !Number.isFinite(multiple) || standardMultiple !== null && Math.abs(multiple - standardMultiple) > 1e-10)) error("采购单位倍数与标准单位换算不符");
    base = standardBase ?? base;
    multiple = standardMultiple ?? multiple;
    if (p?.baseQuantity != null && base !== null && Math.abs(Number(p.baseQuantity) - base) > 1e-10) error("已存在的商品净含量换算不同，请先在单条商品配置中核对，不能直接覆盖共用配置");
    const declared = simpleSpecificationQuantity(row["规格"] || "", pu, mu);
    if (base !== null && declared !== null && Math.abs(base - declared) > 1e-10) error(`商品规格${row["规格"]}与基准单位折算数量${base}不一致`);
    if (confirmed && (!mu || !pu || base === null || multiple === null)) error("已确认换算必须提供统计单位、商品基准单位及两级明确换算数量");
    try {
      const config = measurementSchema.parse({ version: 1, materialName: name, productName: row["品名"], materialUnit: mu, productBaseUnit: pu, productBaseQuantity: base, unitQuantity: multiple });
      configs.set(rowNumber, config);
    } catch { error("归并或换算字段无效，换算数须为正数且最多8位小数"); }
    const key = `${normalizeName(name)}|${normalizeName(row["品名"] || "")}|${normalizeSpecification(productSpecification(row["规格"] || "", row["单位"] || ""))}`;
    const previous = declarations.get(key);
    if (previous) {
      if (previous.materialUnit && mu && previous.materialUnit !== mu || previous.productUnit && pu && previous.productUnit !== pu || previous.baseQuantity !== null && base !== null && previous.baseQuantity !== base) error("同一原材料或商品规格在本文件中的共用换算字段不一致");
      if (mu) previous.materialUnit = mu;
      if (pu) previous.productUnit = pu;
      if (base !== null) previous.baseQuantity = base;
      previous.rows.push(row);
    } else declarations.set(key, { materialUnit: mu, productUnit: pu, baseQuantity: base, rows: [row] });
  }
  const materialUnits = new Map<string, string>();
  for (const d of declarations.values()) for (const row of d.rows) {
    const k = normalizeName(row["统计原材料"]), number = Number(row.__row), c = configs.get(number);
    const previous = materialUnits.get(k);
    if (d.materialUnit && previous && previous !== d.materialUnit) errors.push({ sheet: "原材料", row: number, message: "同一统计原材料使用了不同统计单位" });
    if (d.materialUnit) materialUnits.set(k, d.materialUnit);
    if (c) configs.set(number, { ...c, materialUnit: d.materialUnit, productBaseUnit: d.productUnit, productBaseQuantity: d.baseQuantity });
  }
  // Propagate shared declarations from this very file, never from a name guess.
  for (const [number, config] of configs) configs.set(number, { ...config, materialUnit: materialUnits.get(normalizeName(config.materialName)) || config.materialUnit });
  return { errors, configs };
}
