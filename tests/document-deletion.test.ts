import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
const storage = vi.hoisted(() => ({files: new Map<string, Buffer>(), fail: ""}));
vi.mock("@/server/storage", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/storage")>(),
  objectExists: async (key: string) => storage.files.has(key),
  readObject: async (key: string) => {
    const value = storage.files.get(key); if (!value) throw new Error("missing fixture"); return value;
  },
  deleteObject: async (key: string) => {
    if (key === storage.fail) throw new Error("offline storage failure");
    storage.files.delete(key);
  },
}));
import {getReadyDb} from "@/lib/bootstrap";
import {createDocument} from "@/server/documents";
import {getDocumentDetail, saveDocument} from "@/server/document-service";
import {deleteDraft, deleteDraftPage} from "@/server/document-deletion";
import {recomputeDocumentChecks} from "@/server/checks";
import type {SessionUser} from "@/server/auth";

const admin: SessionUser = {id:"usr_admin",employeeNo:"admin",name:"管理员",globalRole:"ADMIN",memberships:[]};
const staff: SessionUser = {id:"usr_site_sh",employeeNo:"site_sh",name:"采购",globalRole:"STAFF",memberships:[{projectId:"prj_sh",projectName:"上海",projectCode:"SH-HQ",roles:["SUBMITTER"]}]};
afterEach(() => {storage.fail="";vi.restoreAllMocks();});
async function fixture(count=1, existingKey?: string) {
  const db=await getReadyDb();
  const pages=Array.from({length:count},(_,index)=>{
    const objectKey=existingKey||`documents/delete-test/${randomUUID()}-${index}.png`;
    if(!storage.files.has(objectKey))storage.files.set(objectKey,Buffer.from("offline same image bytes"));
    return {objectKey,mime:"image/png",fileName:`page${index+1}.png`};
  });
  const created=await createDocument({userId:staff.id,projectId:"prj_sh",docDate:new Date("2026-10-29T00:00:00+08:00"),pages});
  return db.document.update({where:{id:created.id},data:{status:"DRAFT",supplierId:"sup_sh"},include:{pages:{orderBy:{pageNo:"asc"}}}});
}
async function row(id:string,lineNo:number,pageNo?:number) {
  const db=await getReadyDb();
  return db.documentItem.create({data:{documentId:id,lineNo,name:`材料${lineNo}`,unit:"kg",spec:"kg",quantity:1,unitPrice:10,amount:10,confidence:0.7,ingredientId:"ing_qc",matchStatus:"MATCHED",...(pageNo?{rawOcr:{pageNo,pageLineNo:1}}:{})}});
}

describe("permanent deletion of editable drafts",()=>{
  it("removes a draft and its images, retains an audit trail, and has no recycle record",async()=>{
    const db=await getReadyDb(),d=await fixture();await row(d.id,1,1);
    const processed=d.pages[0].objectKey+"-processed.jpg";storage.files.set(processed,Buffer.from("derived"));
    await db.documentPage.update({where:{id:d.pages[0].id},data:{processedObjectKey:processed}});
    const result=await deleteDraft(staff,d.id,d.version);
    expect(result.deleted).toBe(true);expect(result.warnings).toEqual([]);
    expect(await db.document.findUnique({where:{id:d.id}})).toBeNull();
    expect(await db.documentPage.count({where:{documentId:d.id}})).toBe(0);
    expect(await db.documentItem.count({where:{documentId:d.id}})).toBe(0);
    expect(storage.files.has(d.pages[0].objectKey)).toBe(false);expect(storage.files.has(processed)).toBe(false);
    const audit=await db.auditLog.findFirstOrThrow({where:{entityId:d.id,action:"document.deleted"}});
    expect(audit.documentId).toBeNull();
    expect(await db.auditLog.count({where:{entityId:d.id,action:"document.created",documentId:null}})).toBe(1);
  });
  it("keeps an object still referenced by another record, including a processed-key reference",async()=>{
    const db=await getReadyDb(),d=await fixture(),other=await fixture();
    await db.documentPage.update({where:{id:other.pages[0].id},data:{processedObjectKey:d.pages[0].objectKey}});
    await deleteDraft(admin,d.id,d.version);
    expect(storage.files.has(d.pages[0].objectKey)).toBe(true);
    expect(await db.document.findUnique({where:{id:other.id}})).not.toBeNull();
  });
  it("allows the owner to delete a returned document and retains approval snapshots",async()=>{
    const db=await getReadyDb(),d=await fixture();
    await db.approvalRecord.create({data:{documentId:d.id,reviewerId:admin.id,action:"RETURN",note:"退回修改",beforeValue:{totalAmount:123},afterValue:{status:"NEEDS_REVISION"}}});
    await db.document.update({where:{id:d.id},data:{status:"NEEDS_REVISION"}});
    await deleteDraft(staff,d.id,d.version);
    const audit=await db.auditLog.findFirstOrThrow({where:{entityId:d.id,action:"document.deleted"}});
    expect(audit.beforeValue).toMatchObject({approvals:[{action:"RETURN",beforeValue:{totalAmount:123},afterValue:{status:"NEEDS_REVISION"}}]});
  });
  it("refreshes a remaining draft's duplicate-image error after the duplicate is deleted",async()=>{
    const db=await getReadyDb(),d=await fixture(),other=await fixture();
    await recomputeDocumentChecks(db,other.id);
    expect(await db.checkResult.count({where:{documentId:other.id,type:"duplicate_image"}})).toBeGreaterThan(0);
    // Give this pair a unique content hash so unrelated fixtures do not contribute.
    const hash=randomUUID();
    await db.documentPage.updateMany({where:{documentId:{in:[d.id,other.id]}},data:{sha256:hash}});
    await deleteDraft(admin,d.id,d.version);
    expect(await db.checkResult.count({where:{documentId:other.id,type:"duplicate_image"}})).toBe(0);
  });
  it("deletes only a selected page's rows, renumbers the remaining sources, and retains original headers",async()=>{
    const db=await getReadyDb(),d=await fixture(3);
    await row(d.id,1,1);await row(d.id,2,2);await row(d.id,3,3);
    await db.auditLog.create({data:{entityType:"document",entityId:d.id,documentId:d.id,action:"ocr.completed",afterValue:{pages:[
      {pageNo:1,sourceDocNo:"A",sourceDocDate:"2026-10-20"},
      {pageNo:2,sourceDocNo:"B",sourceDocDate:"2026-10-21"},
      {pageNo:3,sourceDocNo:"C",sourceDocDate:"2026-10-22"},
    ]}}});
    const result=await deleteDraftPage(staff,d.id,d.pages[1].id,d.version);
    expect(result.deleted).toBe(false);
    const detail=await getDocumentDetail(admin,d.id);
    expect(detail.document.pages.map(p=>p.pageNo)).toEqual([1,2]);
    expect(detail.document.pages.map(p=>p.sourceDocNo)).toEqual(["A","C"]);
    expect(detail.document.items.map(i=>i.name)).toEqual(["材料1","材料3"]);
    expect(detail.document.items.map(i=>i.sourcePageNo)).toEqual([1,2]);
    expect(detail.document.items.map(i=>i.lineNo)).toEqual([1,2]);
    expect(detail.document.items.every(i=>i.confidence===0.7&&i.quantity===1&&i.unitPrice===10)).toBe(true);
    expect(detail.document.totalAmount).toBe(0);expect(detail.document.subtotal).toBe(20);
    expect(storage.files.has(d.pages[1].objectKey)).toBe(false);
    expect(storage.files.has(d.pages[0].objectKey)).toBe(true);
    // A later removal uses the renumbered page and preserves C's identity.
    await deleteDraftPage(admin,d.id,detail.document.pages[0].id,detail.document.version);
    const remaining=await getDocumentDetail(admin,d.id);
    expect(remaining.document.pages[0].sourceDocNo).toBe("C");
    expect(remaining.document.items[0].sourcePageNo).toBe(1);
  });
  it("retains legacy rows with no source and explicitly asks for manual checking",async()=>{
    const db=await getReadyDb(),d=await fixture(2);await row(d.id,1);
    const result=await deleteDraftPage(admin,d.id,d.pages[0].id,d.version);
    expect(result.warnings.join()).toContain("没有来源页");
    expect(await db.documentItem.count({where:{documentId:d.id}})).toBe(1);
  });
  it("deleting the last picture deletes the whole draft",async()=>{
    const db=await getReadyDb(),d=await fixture();
    expect((await deleteDraftPage(admin,d.id,d.pages[0].id,d.version)).deleted).toBe(true);
    expect(await db.document.findUnique({where:{id:d.id}})).toBeNull();
  });
  it.each(["PROCESSING","PENDING_REVIEW","APPROVED"] as const)("does not delete %s documents",async status=>{
    const db=await getReadyDb(),d=await fixture();
    await db.document.update({where:{id:d.id},data:{status}});
    await expect(deleteDraft(admin,d.id,d.version)).rejects.toBeInstanceOf(Error);
    expect((await db.document.findUniqueOrThrow({where:{id:d.id}})).status).toBe(status);
    expect(storage.files.has(d.pages[0].objectKey)).toBe(true);
  });
  it.each([
    {...admin,id:"usr_finance",globalRole:"FINANCE" as const},
    {...staff,id:"usr_other",memberships:[]},
    {...staff,id:"usr_supervisor",memberships:[{...staff.memberships[0],roles:["SUPERVISOR" as const]}]},
  ])("rejects finance, outsiders and non-creator supervisors",async user=>{
    const d=await fixture();
    await expect(deleteDraft(user,d.id,d.version)).rejects.toMatchObject({status:403});
    await expect(deleteDraftPage(user,d.id,d.pages[0].id,d.version)).rejects.toMatchObject({status:403});
  });
  it("rejects an old version and a page belonging to another document",async()=>{
    const d=await fixture(2),other=await fixture();
    await expect(deleteDraft(admin,d.id,d.version+1)).rejects.toMatchObject({status:409});
    await expect(deleteDraftPage(admin,d.id,other.pages[0].id,d.version)).rejects.toMatchObject({status:404});
  });
  it("reports storage cleanup failure without pretending the committed deletion was rolled back",async()=>{
    const db=await getReadyDb(),d=await fixture();storage.fail=d.pages[0].objectKey;
    const result=await deleteDraft(admin,d.id,d.version);
    expect(result.deleted).toBe(true);expect(result.warnings.join()).toContain("暂未清理");
    expect(await db.document.findUnique({where:{id:d.id}})).toBeNull();
    expect(storage.files.has(d.pages[0].objectKey)).toBe(true);
    expect(await db.auditLog.count({where:{entityId:d.id,action:"storage.cleanup_failed"}})).toBe(1);
  });
  it("a concurrent save or delete wins once; the losing operation cannot remove winning data",async()=>{
    const db=await getReadyDb(),d=await fixture();await row(d.id,1,1);
    const original=db.$transaction.bind(db);let arrivals=0;let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.spyOn(db,"$transaction").mockImplementation((async(...args:unknown[])=>{
      arrivals++;if(arrivals<=2){if(arrivals===2)release();await gate;}
      return Reflect.apply(original,db,args);
    }) as typeof db.$transaction);
    const results=await Promise.allSettled([
      deleteDraft(admin,d.id,d.version),
      saveDocument(staff,d.id,{version:d.version,docDate:"2026-10-29",projectId:"prj_sh",supplierId:"sup_sh",
        items:[{name:"保存赢家",unit:"kg",quantity:1,unitPrice:10,amount:10,ingredientId:"ing_qc"}],totalAmount:10}),
    ]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const failed=results.find(result=>result.status==="rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({status:409});
    const current=await db.document.findUnique({where:{id:d.id},include:{items:true}});
    if(current) {
      expect(current.items[0].name).toBe("保存赢家");
      expect(storage.files.has(d.pages[0].objectKey)).toBe(true);
    } else expect(await db.auditLog.count({where:{entityId:d.id,action:"document.deleted"}})).toBe(1);
  });
});
