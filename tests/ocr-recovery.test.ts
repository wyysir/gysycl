// Copy to isolated tests/; uses only that workspace's test database.
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const injected = vi.hoisted(() => ({ fail: true, empty: false, total: 42, wait: null as Promise<void> | null, entered: null as (() => void) | null }));
// Exercise database recovery without writing fixtures into the real upload store.
vi.mock('@/server/storage',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('@/server/storage')>();
  const objects=new Map<string,Buffer>();
  return {...actual,
    writeLocalObject:async(key:string,buffer:Buffer)=>{objects.set(key,Buffer.from(buffer));},
    objectExists:async(key:string)=>objects.has(key),
    readObject:async(key:string)=>{const buffer=objects.get(key);if(!buffer)throw new Error('test object missing');return Buffer.from(buffer);},
    deleteObject:async(key:string)=>{objects.delete(key);},
  };
});
vi.mock('@/server/ocr',()=>({
  preprocessImage:async(buffer:Buffer)=>({buffer,mime:'image/jpeg',width:80,height:100}),
  extractDocuments:async()=>{
    injected.entered?.();
    if (injected.wait) await injected.wait;
    if(injected.fail)throw new Error('acceptance simulated channel timeout');
    return {provider:'offline-test',supplierName:'上海鲜禾农副产品有限公司',docNo:'ACCEPT-RECOVERY',docDate:new Date('2026-10-20'),subtotal:42,totalAmount:injected.total,
      items:injected.empty?[]:[{lineNo:1,rawName:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,confidence:1,rawOcr:{}}],warnings:injected.empty?['多张独立单据，请分别上传']:[],raw:{}};
  },
}));
import { getReadyDb } from '@/lib/bootstrap';
import { writeLocalObject,readObject } from '@/server/storage';
import { createDocument,processDocumentOcr } from '@/server/documents';
import { getDocumentDetail,saveDocument,submitDocument } from '@/server/document-service';
import type { SessionUser } from '@/server/auth';

describe('OCR persisted failure recovery and audit',()=>{
  it('claims the queued version before inference so a repeated job cannot make a second paid call',async()=>{
    const db=await getReadyDb();injected.fail=false;let calls=0;
    const raw=await sharp({create:{width:81,height:101,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/job-version-${Date.now()}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_admin',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'job-version.png'}]});
    injected.entered=()=>{calls++;};
    try {
      await processDocumentOcr(doc.id,doc.version);
      await expect(processDocumentOcr(doc.id,doc.version)).rejects.toMatchObject({status:409});
      expect(calls).toBe(1);
      expect((await db.document.findUniqueOrThrow({where:{id:doc.id}})).status).toBe('DRAFT');
    } finally {injected.entered=null;injected.fail=true;await db.document.delete({where:{id:doc.id}});}
  });
  it('empty recognition is a visible failure and preserves earlier rows and originals',async()=>{
    const db=await getReadyDb(); injected.fail=false;
    const raw=await sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/empty-${Date.now()}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_site_sh',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'empty.png'}]});
    await processDocumentOcr(doc.id);
    const before=await db.documentItem.findMany({where:{documentId:doc.id}});
    injected.empty=true;
    try {
      await expect(processDocumentOcr(doc.id)).rejects.toMatchObject({status:422});
      const failed=await db.document.findUniqueOrThrow({where:{id:doc.id},include:{pages:true}});
      expect(failed.status).toBe('DRAFT');expect(failed.ocrError).toContain('未识别出任何明细');
      expect(failed.pages.every(page=>page.status==='FAILED')).toBe(true);
      expect(await db.documentItem.findMany({where:{documentId:doc.id}})).toEqual(before);
      expect(await readObject(key)).toEqual(raw);
    } finally { injected.empty=false;injected.fail=true; }
  });
  it('shows legacy empty completion warnings without modifying historical data',async()=>{
    const db=await getReadyDb();
    const raw=await sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/legacy-${Date.now()}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_site_sh',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'legacy.png'}]});
    await db.document.update({where:{id:doc.id},data:{status:'DRAFT'}});
    await db.auditLog.create({data:{entityType:'document',entityId:doc.id,documentId:doc.id,action:'ocr.completed',afterValue:{itemCount:0,warnings:['多张图片不能确定主单据']}}});
    const user:SessionUser={id:'usr_admin',employeeNo:'admin',name:'管理员',globalRole:'ADMIN',memberships:[]};
    const before=await db.document.findUniqueOrThrow({where:{id:doc.id}});
    const detail=await getDocumentDetail(user,doc.id);
    expect(detail.document.ocrError).toContain('未提取到明细');
    expect(detail.document.ocrWarnings).toContain('多张图片不能确定主单据');
    expect(await db.document.findUniqueOrThrow({where:{id:doc.id}})).toEqual(before);
  });
  it('keeps source page information after manually correcting and saving a recognized row',async()=>{
    const db=await getReadyDb();injected.fail=false;
    const raw=await sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/source-${Date.now()}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_admin',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'source.png'}]});
    try {
      await processDocumentOcr(doc.id);
      const row=await db.documentItem.findFirstOrThrow({where:{documentId:doc.id}});
      await db.documentItem.update({where:{id:row.id},data:{rawOcr:{pageNo:2,pageLineNo:1}}});
      const state=await db.document.findUniqueOrThrow({where:{id:doc.id}});
      const user:SessionUser={id:'usr_admin',employeeNo:'admin',name:'管理员',globalRole:'ADMIN',memberships:[]};
      await saveDocument(user,doc.id,{version:state.version,docDate:'2026-10-20',projectId:'prj_sh',supplierId:'sup_sh',items:[{
        id:row.id,name:'更正名称',unit:'kg',quantity:10,unitPrice:4.2,amount:42,ingredientId:'ing_qc',confidence:0.7,
      }],totalAmount:42});
      const detail=await getDocumentDetail(user,doc.id);
      expect(detail.document.items[0].sourcePageNo).toBe(2);
      expect(detail.document.items[0].name).toBe('更正名称');
      expect(detail.document.items[0].confidence).toBe(0.7);
    } finally {injected.fail=true;}
  });
  it('R03 preserves an explicitly recognized zero total and flags the mismatch',async()=>{
    const db=await getReadyDb();injected.fail=false;injected.total=0;
    try {
      const raw=await sharp({create:{width:82,height:100,channels:3,background:'white'}}).png().toBuffer();
      const key=`documents/acceptance/zero-${Date.now()}.png`;await writeLocalObject(key,raw);
      const doc=await createDocument({userId:'usr_site_sh',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'zero.png'}]});
      await processDocumentOcr(doc.id);
      const result=await db.document.findUniqueOrThrow({where:{id:doc.id},include:{checks:true}});
      expect(Number(result.totalAmount)).toBe(0);
      expect(result.checks.some(check=>check.type==='total_mismatch'&&check.severity==='WARNING')).toBe(true);
    } finally { injected.total=42;injected.fail=true; }
  });
  it.each([false,true])('R04 obsolete OCR task cannot overwrite a newer approval (failure=%s)',async(fail)=>{
    const db=await getReadyDb();injected.fail=fail;
    let release!:()=>void;
    injected.wait=new Promise<void>(resolve=>{release=resolve;});
    const entered=new Promise<void>(resolve=>{injected.entered=resolve;});
    const raw=await sharp({create:{width:83,height:100,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/race-${Date.now()}-${fail}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_site_sh',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'race.png'}]});
    const running=processDocumentOcr(doc.id);
    try {
      await entered;
      await db.document.update({where:{id:doc.id},data:{status:'APPROVED',version:{increment:1},totalAmount:99,notes:'newer approval'}});
      release();
      await expect(running).rejects.toThrow();
      const result=await db.document.findUniqueOrThrow({where:{id:doc.id}});
      expect(result.status).toBe('APPROVED');expect(Number(result.totalAmount)).toBe(99);expect(result.ocrError).toBe('');
      expect(await db.auditLog.count({where:{documentId:doc.id,action:{in:['ocr.completed','ocr.failed']}}})).toBe(0);
    } finally { release();await running.catch(()=>{});injected.wait=null;injected.entered=null;injected.fail=true; }
  });
  it('R01 failure keeps original, moves to editable draft and retries successfully',async()=>{
    const db=await getReadyDb();
    const raw=await sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/recovery-${Date.now()}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_site_sh',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'recovery.png'}]});
    await expect(processDocumentOcr(doc.id)).rejects.toThrow('simulated channel timeout');
    const failed=await db.document.findUniqueOrThrow({where:{id:doc.id}});expect(failed.status).toBe('DRAFT');expect(failed.ocrError).toContain('simulated channel timeout');expect(await readObject(key)).toEqual(raw);
    expect(await db.auditLog.count({where:{documentId:doc.id,action:'ocr.failed'}})).toBe(1);
    injected.fail=false;await processDocumentOcr(doc.id);
    const retried=await db.document.findUniqueOrThrow({where:{id:doc.id},include:{items:true}});expect(retried.ocrError).toBe('');expect(retried.items).toHaveLength(1);expect(retried.status).toBe('DRAFT');
    expect(retried.items[0].spec).toBe(retried.items[0].unit);
    expect(doc.docNo).toMatch(/^SHD-\d{8}-[A-F0-9]{32}$/);
    expect(retried.docNo).toBe(doc.docNo); // OCR headers must never overwrite system numbering.
  });
  it('R02 manual save after failure records both field snapshots and submits without notifications',async()=>{
    const db=await getReadyDb();injected.fail=true;
    const raw=await sharp({create:{width:81,height:100,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/manual-${Date.now()}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_site_sh',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'manual.png'}]});
    await expect(processDocumentOcr(doc.id)).rejects.toThrow();
    const failed=await db.document.findUniqueOrThrow({where:{id:doc.id}});
    const user:SessionUser={id:'usr_site_sh',employeeNo:'site_sh',name:'验收采购',globalRole:'STAFF',memberships:[{projectId:'prj_sh',projectName:'上海总部食堂',projectCode:'SH-HQ',roles:['SUBMITTER']}]};
    await saveDocument(user,doc.id,{version:failed.version,docDate:'2026-10-20',docNo:'ACCEPT-MANUAL',projectId:'prj_sh',supplierId:'sup_sh',items:[{name:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,ingredientId:'ing_qc',confidence:1}],totalAmount:42});
    const audit=await db.auditLog.findFirstOrThrow({where:{documentId:doc.id,action:'document.updated'}});expect(audit.beforeValue).toHaveProperty('items');expect(audit.afterValue).toHaveProperty('items');
    await submitDocument(user,doc.id);expect(await db.notification.count({where:{documentId:doc.id}})).toBe(0);
  });
});
