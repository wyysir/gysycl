import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getReadyDb } from "@/lib/bootstrap";
import { normalizeName, normalizeSpecification } from "@/lib/text";
import { chooseMaterial } from "@/lib/material-choice";
import { createMaterialCatalogue } from "@/server/material-catalogue";
import { resolveMaterialLink } from "@/server/material-linking";
import { recheckDocument, saveDocument } from "@/server/document-service";
import { getDocumentDetail } from "@/server/document-service";
import { createSessionToken, type SessionUser } from "@/server/auth";
import { GET } from "@/app/api/master-data/material-lookup/route";
const admin: SessionUser = { id: "usr_admin", name: "管理员", employeeNo: "admin", globalRole: "ADMIN", memberships: [] };
const ids: string[] = [], docs: string[] = [], marker = "检索回归" + randomUUID();
async function material(name: string, unit = "斤", spec = "", alias?: string, provisional = false) {
 const db = await getReadyDb();
 const item = await db.ingredient.create({ data: { name, normalizedName: normalizeName(name), spec, normalizedSpec: normalizeSpecification(spec), unit,
  notes: provisional ? "用户指定默认采购单位为斤，待核实" : "", aliases: alias ? { create: { alias, normalizedAlias: normalizeName(alias) } } : undefined } });
 ids.push(item.id);return item;
}
async function document(name: string, unit = "", ingredientId: string | null = null, status: "DRAFT" | "APPROVED" = "DRAFT") {
 const db=await getReadyDb();const doc=await db.document.create({data:{projectId:"prj_sh",supplierId:"sup_sh",createdById:admin.id,status,docDate:new Date("2026-11-20"),subtotal:20,totalAmount:20,items:{create:{lineNo:1,name,rawName:name,spec:"",unit,ingredientId,quantity:2,unitPrice:10,amount:20,confidence:.6,rawOcr:{rawName:name,unit,unitConfidence:0,sourcePageNo:1}}}},include:{items:true}});docs.push(doc.id);return doc;
}
afterAll(async()=>{const db=await getReadyDb();await db.document.deleteMany({where:{id:{in:docs}}});await db.ingredient.deleteMany({where:{id:{in:ids}}});});
describe("品名检索与单位独立确认",()=>{
 it("returns every unit in the selected group rather than truncating to three, without prices",async()=>{
  const name=marker+"多单位";for(const u of["斤","kg","包","箱","g"])await material(name,u);
  const cat=await createMaterialCatalogue(await getReadyDb()),g=cat.search(name)[0];expect(g.options).toHaveLength(5);
  const token=await createSessionToken(admin.id);const r=await GET(new NextRequest("http://localhost:3000/api/master-data/material-lookup?q="+encodeURIComponent(name),{headers:{Cookie:"delivery_session="+token}}));
  expect(r.status).toBe(200);const json=await r.json();expect(json.groups[0].options).toHaveLength(5);expect(JSON.stringify(json)).not.toContain("unitPrice");
  expect((await GET(new NextRequest("http://localhost:3000/api/master-data/material-lookup?q=肉"))).status).toBe(401);
 });
 it("single-name lookup fills only a blank unit, retains OCR provenance and numeric values",async()=>{
  const name=marker+"乌鸡",m=await material(name,"斤","",undefined,true),doc=await document(name);
  const original=doc.items[0];await recheckDocument(admin,doc.id);
  const detail=await getDocumentDetail(admin,doc.id),item=detail.document.items[0];
  expect(item).toMatchObject({name,ingredientId:m.id,unit:"斤",quantity:2,unitPrice:10,amount:20,confidence:.6,originalUnit:""});
  expect(item.materialChoice).toMatchObject({source:"master",confirmedUnit:null,provisional:true});
  expect(detail.document.checks.some(c=>c.type==="unit_from_master")).toBe(true);expect(detail.document.checks.some(c=>c.type==="ingredient_unmatched")).toBe(false);
  const after=await (await getReadyDb()).documentItem.findFirstOrThrow({where:{documentId:doc.id}});expect(after.rawOcr).toMatchObject({rawName:name,unit:"",unitConfidence:0,sourcePageNo:1});expect(Number(after.quantity)).toBe(Number(original.quantity));
 });
 it("a known name with a conflicting unit stays chosen but does not use the wrong purchase record",async()=>{
  const name=marker+"牛蛙";await material(name);const doc=await document(name,"箱");await recheckDocument(admin,doc.id);
  const detail=await getDocumentDetail(admin,doc.id),item=detail.document.items[0];expect(item).toMatchObject({name,unit:"箱",ingredientId:null,quantity:2,unitPrice:10,amount:20});expect(item.materialChoice?.name).toBe(name);
  expect(detail.document.checks).toEqual(expect.arrayContaining([expect.objectContaining({type:"unit_mismatch",severity:"ERROR"})]));expect(detail.document.checks.some(c=>c.type==="ingredient_unmatched")).toBe(false);
 });
 it("multiple units await selection and switching unit switches the purchase record, not the name or numbers",async()=>{
  const name=marker+"鱼片",a=await material(name,"斤"),b=await material(name,"箱"),doc=await document(name);await recheckDocument(admin,doc.id);
  const d=(await getDocumentDetail(admin,doc.id)).document;expect(d.items[0].unit).toBe("");expect(d.items[0].ingredientId).toBeNull();
  const g=(await createMaterialCatalogue(await getReadyDb())).exact(name,"")!;
  const first=chooseMaterial(d.items[0],g,"斤"),second=chooseMaterial({...d.items[0],...first},g,"箱");expect(first.ingredientId).toBe(a.id);expect(second.ingredientId).toBe(b.id);expect(second.name).toBe(name);
  const saved=await saveDocument(admin,doc.id,{version:d.version,docDate:d.docDate,projectId:d.projectId,supplierId:d.supplierId,items:[{...d.items[0],...second}],totalAmount:20});
  expect(saved.document.items[0]).toMatchObject({ingredientId:b.id,unit:"箱",quantity:2,unitPrice:10,amount:20});
 });
 it("same-name different specifications and shared aliases never select the first record arbitrarily",async()=>{
  const name=marker+"酱油";await material(name,"瓶","1.9l");await material(name,"瓶","19l");
  const alias=marker+"共用简称";await material(marker+"甲","斤","",alias);await material(marker+"乙","斤","",alias);
  const cat=await createMaterialCatalogue(await getReadyDb());expect(cat.exact(name,"")).toBeNull();expect(cat.exact(name,"1.9L")?.spec).toBe("1.9l");expect(cat.exact(alias,"")).toBeNull();
  await material(marker+"红薯叶");expect((await createMaterialCatalogue(await getReadyDb())).exact(marker+"红薯","")).toBeNull();
 });
 it("confirmed units survive save/recovery, while client-forged original OCR fields are not accepted",async()=>{
  const name=marker+"确认",m=await material(name),doc=await document(name);await recheckDocument(admin,doc.id);const d=(await getDocumentDetail(admin,doc.id)).document;
  const input={...d.items[0],originalUnit:"伪造的原图单位",materialChoice:{...d.items[0].materialChoice!,source:"manual" as const,confirmedUnit:"斤"}};
  const saved=await saveDocument(admin,doc.id,{version:d.version,docDate:d.docDate,projectId:d.projectId,supplierId:d.supplierId,items:[input],totalAmount:20});expect(saved.document.items[0].originalUnit).toBe("");expect(saved.document.items[0].ingredientId).toBe(m.id);expect(saved.document.checks.some(c=>c.type==="unit_from_master")).toBe(false);
 });
 it("stale candidates are rejected and recheck respects existing links, permissions and approved history",async()=>{
  const name=marker+"版本",m=await material(name),db=await getReadyDb(),cat=await createMaterialCatalogue(db),doc=await document(name),g=cat.exact(name,"")!;
  const patch=chooseMaterial({name,spec:"",unit:"",ingredientId:null},g);await db.ingredient.update({where:{id:m.id},data:{version:{increment:1}}});
  const fresh=await createMaterialCatalogue(db);expect(()=>resolveMaterialLink(fresh,{...doc.items[0],...patch},doc.items[0])).toThrow("已变化");
  await expect(recheckDocument({...admin,globalRole:"FINANCE"},doc.id)).rejects.toMatchObject({status:403});
  const linked=await document(name,"斤",m.id),before=await db.documentItem.findFirstOrThrow({where:{documentId:linked.id}});await recheckDocument(admin,linked.id);expect(await db.documentItem.findUnique({where:{id:before.id}})).toEqual(before);
  const approved=await document(name,"斤",m.id,"APPROVED"),approvedBefore=await db.documentItem.findFirstOrThrow({where:{documentId:approved.id}});await expect(recheckDocument(admin,approved.id)).rejects.toMatchObject({status:403});expect(await db.documentItem.findUnique({where:{id:approvedBefore.id}})).toEqual(approvedBefore);
 });
 it("stopping a material preserves an unchanged historical link but forbids fresh selection",async()=>{
  const name=marker+"停用",m=await material(name),db=await getReadyDb(),doc=await document(name);await recheckDocument(admin,doc.id);
  const d=(await getDocumentDetail(admin,doc.id)).document;await db.ingredient.update({where:{id:m.id},data:{active:false}});
  const saved=await saveDocument(admin,doc.id,{version:d.version,docDate:d.docDate,projectId:d.projectId,supplierId:d.supplierId,items:d.items,totalAmount:20});
  expect(saved.document.items[0].ingredientId).toBe(m.id);
  const cat=await createMaterialCatalogue(db);expect(cat.exact(name,"")).toBeNull();
  expect(()=>resolveMaterialLink(cat,{...d.items[0],id:undefined},null)).toThrow("重新检索");
 });
});
