import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { ApiError, requireUser } from "@/server/auth";
import { handleApiError } from "@/server/http";
import { getAnalytics } from "@/server/analytics";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!hasPermission(user, "document.export")) throw new ApiError(403, "没有导出权限");
    const p = request.nextUrl.searchParams, data = await getAnalytics(user, { from: p.get("from") || "", to: p.get("to") || "", projectId: p.get("projectId") || "" });
    const workbook = new ExcelJS.Workbook(), summary = workbook.addWorksheet("原材料采购汇总"), detail = workbook.addWorksheet("商品规格与采购单位");
    summary.addRow(["原材料", "商品规格组数", "统计单位", "统一采购数量", "采购金额", "加权采购均价", "待确认换算明细数", "归并状态"]);
    detail.addRow(["原材料", "商品名称", "商品规格", "采购单位", "原始数量", "统计单位", "统一数量", "采购金额", "加权采购均价", "换算状态"]);
    for (const row of data.materials) {
      summary.addRow([row.name, row.specificationCount, row.unit || "待确认", row.quantity, row.amountRestricted ? "未授权" : row.amount,
        row.priceRestricted || row.amountRestricted ? "未授权" : row.averagePrice, row.pending, row.configured ? "已归并" : "待确认归属"]);
      for (const v of row.variants) detail.addRow([row.name, v.name, v.spec || "未注明", v.purchaseUnit, v.originalQuantity, row.unit || "待确认", v.quantity,
        v.amountRestricted ? "未授权" : v.amount, v.priceRestricted || v.amountRestricted ? "未授权" : v.averagePrice, v.pending ? "待确认" : "已确认"]);
    }
    for (const sheet of [summary, detail]) {
      sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.getRow(1).height = 30;
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF775740" } };
      sheet.columns.forEach(column => { column.width = 23; });
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    }
    const bytes = await workbook.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(bytes as ArrayBuffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="material-analysis.xlsx"', "Cache-Control": "no-store" } });
  } catch (error) { return handleApiError(error); }
}
