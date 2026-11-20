import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getReadyDb } from "@/lib/bootstrap";
import { buildMasterTemplate, importMasterWorkbook } from "@/server/excel";
import { measurementImportHeaders } from "@/server/measurement-import";
import { freezeDocumentMeasurements } from "@/server/measurements";
import { aggregateMaterialPurchases } from "@/server/measurement-analysis";
import type { SessionUser } from "@/server/auth";

const admin: SessionUser = { id: "usr_admin", employeeNo: "admin", name: "管理员", globalRole: "ADMIN", memberships: [] };
const marker = "导入换算" + randomUUID(), batchIds: string[] = [], docIds: string[] = [];
async function workbook(rows: Record<string,string>[]) {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet("原材料");s.addRow(measurementImportHeaders);
  rows.forEach(row => s.addRow(measurementImportHeaders.map(key => row[key] || "")));
  return Buffer.from(await w.xlsx.writeBuffer());
}
function item(spec="500ml",unit="瓶",other:Record<string,string>={}) {
  return { "商品名称":marker,"商品规格":spec,"采购单位":unit,"统计原材料":marker,"统计单位":"l","商品基准单位":"瓶","基准单位折合统计数量":spec==="1l"?"1":"0.5","采购单位倍数":unit==="箱"?"12":"1","换算确认":"是",...other };
}
afterEach(async()=>{
  const db=await getReadyDb();await db.document.deleteMany({where:{id:{in:docIds}}});
  const rows=await db.ingredient.findMany({where:{name:marker},select:{id:true}});
  await db.auditLog.deleteMany({where:{entityId:{in:rows.map(r=>r.id)}}});await db.ingredient.deleteMany({where:{id:{in:rows.map(r=>r.id)}}});
  const materials=await db.materialIdentity.findMany({where:{name:marker},select:{id:true}});await db.productSpecification.deleteMany({where:{materialId:{in:materials.map(r=>r.id)}}});await db.materialIdentity.deleteMany({where:{id:{in:materials.map(r=>r.id)}}});
  await db.importBatch.deleteMany({where:{id:{in:batchIds}}});batchIds.splice(0);docIds.splice(0);
});
it("新模板明确区分商品规格、采购单位及统计归属，旧模板仍可读取",async()=>{
  const w=new ExcelJS.Workbook();await w.xlsx.load(await buildMasterTemplate("ingredients") as unknown as ExcelJS.Buffer);
  expect(w.getWorksheet("原材料")!.getRow(1).values).toEqual([undefined,...measurementImportHeaders]);
  const legacy=new ExcelJS.Workbook();legacy.addWorksheet("原材料").addRows([["品名","规格","单位"],[marker,"500ml","瓶"]]);
  expect((await importMasterWorkbook(admin,Buffer.from(await legacy.xlsx.writeBuffer()),true,"ingredients")).errors).toEqual([]);
});
it("导入两种规格、三种采购条目后，报表只汇总一种原材料，瓶箱正确换算",async()=>{
  const bytes=await workbook([item(),item("500ml","箱"),item("1l")]);
  expect((await importMasterWorkbook(admin,bytes,true,"ingredients")).errors).toEqual([]);
  const result=await importMasterWorkbook(admin,bytes,false,"ingredients");expect(result.errors).toEqual([]);batchIds.push(result.importBatchId!);
  const db=await getReadyDb(),rows=await db.ingredient.findMany({where:{name:marker},include:{productSpecification:true}});expect(rows).toHaveLength(3);
  expect(new Set(rows.map(r=>r.productSpecification!.materialId)).size).toBe(1);expect(new Set(rows.map(r=>r.productSpecificationId)).size).toBe(2);
  for(const r of rows){const q=r.spec==="1l"?2:1,a=r.unit==="箱"?120:r.spec==="1l"?40:12;const d=await db.document.create({data:{projectId:"prj_sh",createdById:admin.id,status:"APPROVED",docDate:new Date(),items:{create:{ingredientId:r.id,name:r.name,spec:r.spec,unit:r.unit,quantity:q,unitPrice:a/q,amount:a,lineNo:1}}}});docIds.push(d.id);await db.$transaction(tx=>freezeDocumentMeasurements(tx,d.id));}
  const docs=await db.document.findMany({where:{id:{in:docIds}},include:{items:true,project:true}});
  expect(aggregateMaterialPurchases(admin,docs)).toHaveLength(1);expect(aggregateMaterialPurchases(admin,docs)[0]).toMatchObject({specificationCount:2,amount:172,quantity:8.5,averagePrice:20.2353});
});
it("未知箱规可导入归属但不编造倍数，数值未确认则拒绝导入",async()=>{
  const pending=item("500ml","箱",{"换算确认":"待确认","采购单位倍数":"","基准单位折合统计数量":"","统计单位":"","商品基准单位":""});
  const bytes=await workbook([pending]),result=await importMasterWorkbook(admin,bytes,false,"ingredients");expect(result.errors).toEqual([]);batchIds.push(result.importBatchId!);
  const row=await (await getReadyDb()).ingredient.findFirstOrThrow({where:{name:marker},include:{productSpecification:true}});expect(row.quantityPerProductUnit).toBeNull();expect(row.productSpecification!.baseQuantity).toBeNull();
  const bad=await importMasterWorkbook(admin,await workbook([item("500ml","箱",{"换算确认":"待确认"})]),true,"ingredients");expect(bad.errors.some(e=>e.message.includes("尚未确认"))).toBe(true);
});
it("同规格基准、物料统计单位冲突及错误标准换算整批拒绝",async()=>{
  for(const rows of [[item(),item("500ml","箱",{"商品基准单位":"箱"})],[item(),item("1l","瓶",{"统计单位":"kg"})],[item("500ml","瓶",{"采购单位倍数":"12"})]]){
    const result=await importMasterWorkbook(admin,await workbook(rows),false,"ingredients");expect(result.errors.length).toBeGreaterThan(0);expect(await (await getReadyDb()).ingredient.count({where:{name:marker}})).toBe(0);
  }
});
it("只有导入权限但没有维护权限时，不能通过表格修改归并配置",async()=>{
  const user:SessionUser={...admin,globalRole:"STAFF",memberships:[{projectId:"prj_sh",projectCode:"SH",projectName:"上海",roles:[],permissions:["master.import"]}]};
  const result=await importMasterWorkbook(user,await workbook([item()]),true,"ingredients");expect(result.errors.some(e=>e.message.includes("归并与换算维护权限"))).toBe(true);
});
