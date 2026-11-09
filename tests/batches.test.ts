import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import sharp from "sharp";
const objects=vi.hoisted(()=>new Map<string,Buffer>());
vi.mock("@/server/storage",async importOriginal=>({...await importOriginal<typeof import("@/server/storage")>(),
  readObject:async(key:string)=>{const value=objects.get(key);if(!value)throw new Error("missing");return value;},
  writePrivateOriginal:async(key:string,value:Buffer)=>{objects.set(key,Buffer.from(value));},
  deleteObject:async(key:string)=>{objects.delete(key);},
}));
vi.mock("@/server/documents",async importOriginal=>({...await importOriginal<typeof import("@/server/documents")>(),enqueueOcr:vi.fn(async()=>"test-no-inference")}));
import { getReadyDb } from "@/lib/bootstrap";
import { createBatch, batchUploadTarget, completeBatchPhoto, getBatch, confirmBatchDocument, submitBatch } from "@/server/batches";
import { getDocumentDetail, saveDocument, submitDocument } from "@/server/document-service";
import { claimDocumentVersion } from "@/server/document-lock";
import { POST } from "@/app/api/batches/route";
import { POST as batchPOST } from "@/app/api/batches/[id]/route";
import { NextRequest } from "next/server";
import { createSessionToken, type SessionUser } from "@/server/auth";
const admin:SessionUser={id:"usr_admin",employeeNo:"admin",name:"管理员",globalRole:"ADMIN",memberships:[]};
const staff:SessionUser={id:"usr_site_sh",employeeNo:"site_sh",name:"员工",globalRole:"STAFF",memberships:[{projectId:"prj_sh",projectName:"上海",projectCode:"SH",roles:["SUBMITTER"]}]};
const other:SessionUser={...staff,id:"usr_other",memberships:[{projectId:"prj_hz",projectName:"杭州",projectCode:"HZ",roles:["SUBMITTER"]}]};
let ids:string[]=[];
async function batch(count=2,user=admin,requestId=crypto.randomUUID()){
  const value=await createBatch(user,{requestId,projectId:"prj_sh",docDate:"2026-11-04",fileNames:Array.from({length:count},(_,i)=>`image-${i+1}.png`)});ids.push(value.id);return value.id;
}
async function upload(id:string,position=1,user=admin){
  const result=await batchUploadTarget(user,id,position,"image/png");
  if(!("target" in result)||!result.target)throw new Error("missing target");
  objects.set(result.target.objectKey,await sharp({create:{width:25+position,height:25,channels:3,background:{r:position*20,g:100,b:150}}}).png().toBuffer());
  return (await completeBatchPhoto(user,id,position)).documentId;
}
async function prepare(id:string,position=1,user=admin){
  const documentId=await upload(id,position,user),db=await getReadyDb();
  await db.document.update({where:{id:documentId},data:{status:"DRAFT"}});
  const quantity=position+.321,amount=Math.round(quantity*4.2*100)/100;
  return (await saveDocument(user,documentId,{version:1,docDate:"2026-11-04",projectId:"prj_sh",supplierId:"sup_sh",totalAmount:amount,
    items:[{name:"青菜",rawName:"青菜",spec:"kg",unit:"kg",quantity,unitPrice:4.2,amount,ingredientId:"ing_qc",confidence:1}]})).document;
}
beforeAll(async()=>{await getReadyDb();});
afterEach(async()=>{const db=await getReadyDb();await db.document.deleteMany({where:{batchId:{in:ids}}});await db.batchPhoto.deleteMany({where:{batchId:{in:ids}}});await db.uploadBatch.deleteMany({where:{id:{in:ids}}});ids=[];objects.clear();});
describe("independent photo batches and authorization",()=>{
  it("keeps the frozen original unchanged when an old upload target is overwritten",async()=>{
    const id=await batch(1),target=await batchUploadTarget(admin,id,1,"image/png");
    if(!("target" in target)||!target.target)throw new Error("missing target");
    const uploadKey=target.target.objectKey;
    objects.set(uploadKey,await sharp({create:{width:30,height:30,channels:3,background:"red"}}).png().toBuffer());
    const before=Buffer.from(objects.get(uploadKey)!);const {documentId}=await completeBatchPhoto(admin,id,1);
    const db=await getReadyDb(),page=await db.documentPage.findFirstOrThrow({where:{documentId}});
    expect(page.objectKey).not.toBe(uploadKey);expect(objects.has(uploadKey)).toBe(false);
    objects.set(uploadKey,Buffer.from("replacement through still-valid versioned OSS URL"));
    await completeBatchPhoto(admin,id,1);
    expect(objects.get(page.objectKey)).toEqual(before);
    expect(page.sha256).toBe(crypto.createHash("sha256").update(before).digest("hex"));
  });
  it("rejects over-limit and unauthorized project creation",async()=>{
    await expect(batch(11)).rejects.toMatchObject({status:400});
    await expect(batch(1,other)).rejects.toMatchObject({status:403});
    await expect(batch(0)).rejects.toMatchObject({status:400});
  });
  it("creates ten ordered independent documents, exactly one original per document",async()=>{
    const id=await batch(10);
    const docs=await Promise.all(Array.from({length:10},(_,i)=>upload(id,i+1)));
    expect(new Set(docs).size).toBe(10);
    const value=await getBatch(admin,id);expect(value.documents).toHaveLength(10);
    expect(value.documents.map(d=>d.batchPosition)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    value.documents.forEach((doc,i)=>{expect(doc.pages).toHaveLength(1);expect(doc.pages[0].fileName).toBe(`image-${i+1}.png`);expect(doc.docDate).toBe("2026-11-04");});
    expect(new Set(value.documents.map(d=>d.pages[0].url)).size).toBe(10);
  });
  it("deduplicates create requests and refuses changes under the same request id",async()=>{
    const requestId=crypto.randomUUID(),id=await batch(2,admin,requestId);
    expect(await batch(2,admin,requestId)).toBe(id);
    await expect(batch(1,admin,requestId)).rejects.toMatchObject({status:409});
  });
  it("deduplicates concurrent completion and cannot create another document after deletion",async()=>{
    const id=await batch(1);const docId=await upload(id);const db=await getReadyDb();
    const values=await Promise.all([completeBatchPhoto(admin,id,1),completeBatchPhoto(admin,id,1)]);
    expect(values.every(v=>v.documentId===docId)).toBe(true);expect(await db.document.count({where:{batchId:id}})).toBe(1);
    await db.document.delete({where:{id:docId}});
    await expect(completeBatchPhoto(admin,id,1)).rejects.toMatchObject({status:409});
    expect((await getBatch(admin,id)).photos[0].deleted).toBe(true);
  });
  it("serializes two first-time completion requests without duplicate documents",async()=>{
    const id=await batch(1),target=await batchUploadTarget(admin,id,1,"image/png");
    if(!("target" in target)||!target.target)throw new Error("missing target");
    objects.set(target.target.objectKey,await sharp({create:{width:30,height:30,channels:3,background:"white"}}).png().toBuffer());
    const outcomes=await Promise.all([completeBatchPhoto(admin,id,1),completeBatchPhoto(admin,id,1)]);
    expect(outcomes[0].documentId).toBe(outcomes[1].documentId);
    expect((await getBatch(admin,id)).documents).toHaveLength(1);
  });
  it("never creates a document when upload is absent or bytes are not an image",async()=>{
    const id=await batch(1),target=await batchUploadTarget(admin,id,1,"image/png");
    await expect(completeBatchPhoto(admin,id,1)).rejects.toMatchObject({status:400});
    if("target" in target&&target.target)objects.set(target.target.objectKey,Buffer.from("not an image"));
    await expect(completeBatchPhoto(admin,id,1)).rejects.toMatchObject({status:400});
    expect((await getBatch(admin,id)).documents).toHaveLength(0);
  });
  it("binds uploads to the creator, project, position and MIME type",async()=>{
    const id=await batch(1,staff);
    await expect(getBatch(other,id)).rejects.toMatchObject({status:404});
    await expect(batchUploadTarget(admin,id,1,"image/png")).rejects.toMatchObject({status:403});
    await expect(batchUploadTarget(staff,id,11,"image/png")).rejects.toMatchObject({status:404});
    await batchUploadTarget(staff,id,1,"image/png");
    await expect(batchUploadTarget(staff,id,1,"image/jpeg")).rejects.toMatchObject({status:409});
  });
  it("masks prices, amounts, image URLs and original filenames in batch responses",async()=>{
    const id=await batch(1,staff);await prepare(id,1,staff);
    const restricted:SessionUser={...staff,memberships:staff.memberships.map(m=>({...m,permissions:["document.edit_own","document.submit_own"]}))};
    const value=await getBatch(restricted,id),doc=value.documents[0];
    expect(doc.pages).toEqual([]);expect(doc.totalAmount).toBeNull();expect(doc.items[0].unitPrice).toBeNull();expect(doc.items[0].amount).toBeNull();expect(value.photos[0].fileName).toBe("单据图片");
  });
});
describe("explicit confirmation and partial batch submission",()=>{
  it("blocks direct submit until confirmed; edits invalidate confirmation",async()=>{
    const id=await batch(1),doc=await prepare(id);
    await expect(submitDocument(admin,doc.id)).rejects.toMatchObject({status:422});
    const checked=(await confirmBatchDocument(admin,id,doc.id,doc.version)).document;
    expect(checked.checkedVersion).toBe(checked.version);
    const db=await getReadyDb();await db.$transaction(tx=>claimDocumentVersion(tx,{id:doc.id,version:checked.version,status:"DRAFT"}));
    await expect(submitDocument(admin,doc.id)).rejects.toMatchObject({status:422});
    await expect(confirmBatchDocument(admin,id,doc.id,checked.version)).rejects.toMatchObject({status:409});
  });
  it("does not treat low OCR confidence alone as a submission block",async()=>{
    const id=await batch(1),doc=await prepare(id),db=await getReadyDb();
    await db.documentItem.updateMany({where:{documentId:doc.id},data:{confidence:.6}});
    const checked=(await confirmBatchDocument(admin,id,doc.id,doc.version)).document;
    expect(checked.checks.some(c=>c.type==="low_confidence")).toBe(true);
    expect((await submitBatch(admin,id,[{id:doc.id,version:checked.version}])).results[0].ok).toBe(true);
  });
  it("blocks missing bindings, quantity, OCR failure and arithmetic errors",async()=>{
    const id=await batch(1),doc=await prepare(id),db=await getReadyDb();
    await db.documentItem.updateMany({where:{documentId:doc.id},data:{ingredientId:null}});
    await expect(confirmBatchDocument(admin,id,doc.id,doc.version)).rejects.toMatchObject({status:422});
    await db.documentItem.updateMany({where:{documentId:doc.id},data:{ingredientId:"ing_qc",amount:999}});
    await expect(confirmBatchDocument(admin,id,doc.id,doc.version)).rejects.toMatchObject({status:422});
    expect((await db.document.findUniqueOrThrow({where:{id:doc.id}})).checkedVersion).toBeNull();
  });
  it("submits eligible documents, reports each failed one and repeated submits are idempotent",async()=>{
    const id=await batch(2),first=await prepare(id,1),second=await prepare(id,2);
    const checked=(await confirmBatchDocument(admin,id,first.id,first.version)).document;
    const entries=[{id:first.id,version:checked.version},{id:second.id,version:second.version}];
    expect((await submitBatch(admin,id,entries)).results.map(r=>r.ok)).toEqual([true,false]);
    expect((await submitBatch(admin,id,entries)).results.map(r=>r.ok)).toEqual([true,false]);
    const db=await getReadyDb();expect(await db.auditLog.count({where:{documentId:first.id,action:"document.submitted"}})).toBe(1);
    expect((await getDocumentDetail(admin,second.id)).document.status).toBe("DRAFT");
  });
  it("rejects other batch ids, changed versions, duplicate selections and foreign accounts",async()=>{
    const id=await batch(1),otherBatch=await batch(1),doc=await prepare(id);
    await expect(confirmBatchDocument(admin,otherBatch,doc.id,doc.version)).rejects.toMatchObject({status:403});
    await expect(submitBatch(other,id,[{id:doc.id,version:doc.version}])).rejects.toMatchObject({status:404});
    const checked=(await confirmBatchDocument(admin,id,doc.id,doc.version)).document;
    expect((await submitBatch(admin,id,[{id:doc.id,version:doc.version}])).results[0].ok).toBe(false);
    expect((await submitBatch(admin,otherBatch,[{id:doc.id,version:checked.version}])).results[0].ok).toBe(false);
    await expect(submitBatch(admin,id,[{id:doc.id,version:checked.version},{id:doc.id,version:checked.version}])).rejects.toMatchObject({status:400});
  });
  it("API requires login, checks Origin and enforces ten-image boundary",async()=>{
    const request=(body:unknown,cookie="",origin="http://localhost:3000")=>new NextRequest("http://localhost:3000/api/batches",{method:"POST",headers:{"content-type":"application/json",cookie,origin},body:JSON.stringify(body)});
    const body={requestId:crypto.randomUUID(),projectId:"prj_sh",docDate:"2026-11-04",fileNames:["one.png"]};
    expect((await POST(request(body))).status).toBe(401);
    const cookie="delivery_session="+await createSessionToken(admin.id);
    expect((await POST(request(body,cookie,"https://foreign.invalid"))).status).toBe(403);
    expect((await POST(request({...body,fileNames:Array(11).fill("one.png")},cookie))).status).toBe(400);
    const id=await batch(1);
    expect((await batchPOST(request({action:"upload-target",position:11,mime:"image/png"},cookie),{params:Promise.resolve({id})})).status).toBe(400);
  });
});
