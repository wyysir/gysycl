// Copy to isolated tests/; uses only that workspace's test database.
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const injected = vi.hoisted(() => ({ fail: true }));
vi.mock('@/server/ocr',()=>({
  preprocessImage:async(buffer:Buffer)=>({buffer,mime:'image/jpeg',width:80,height:100}),
  extractDocuments:async()=>{
    if(injected.fail)throw new Error('acceptance simulated channel timeout');
    return {provider:'offline-test',supplierName:'上海鲜禾农副产品有限公司',docNo:'ACCEPT-RECOVERY',docDate:new Date('2026-10-20'),subtotal:42,totalAmount:42,
      items:[{lineNo:1,rawName:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,confidence:1,rawOcr:{}}],warnings:[],raw:{}};
  },
}));
import { getReadyDb } from '@/lib/bootstrap';
import { writeLocalObject,readObject } from '@/server/storage';
import { createDocument,processDocumentOcr } from '@/server/documents';
import { saveDocument,submitDocument } from '@/server/document-service';
import type { SessionUser } from '@/server/auth';

describe('OCR persisted failure recovery and audit',()=>{
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
  });
  it('R02 manual save after failure records both field snapshots and creates supervisor notice',async()=>{
    const db=await getReadyDb();injected.fail=true;
    const raw=await sharp({create:{width:81,height:100,channels:3,background:'white'}}).png().toBuffer();
    const key=`documents/acceptance/manual-${Date.now()}.png`;await writeLocalObject(key,raw);
    const doc=await createDocument({userId:'usr_site_sh',projectId:'prj_sh',docDate:new Date('2026-10-20'),pages:[{objectKey:key,mime:'image/png',fileName:'manual.png'}]});
    await expect(processDocumentOcr(doc.id)).rejects.toThrow();
    const failed=await db.document.findUniqueOrThrow({where:{id:doc.id}});
    const user:SessionUser={id:'usr_site_sh',employeeNo:'site_sh',name:'验收采购',globalRole:'STAFF',memberships:[{projectId:'prj_sh',projectName:'上海总部食堂',projectCode:'SH-HQ',roles:['SUBMITTER']}]};
    await saveDocument(user,doc.id,{version:failed.version,docDate:'2026-10-20',docNo:'ACCEPT-MANUAL',projectId:'prj_sh',supplierId:'sup_sh',items:[{name:'青菜',spec:'散装',unit:'kg',quantity:10,unitPrice:4.2,amount:42,ingredientId:'ing_qc',confidence:1}],totalAmount:42});
    const audit=await db.auditLog.findFirstOrThrow({where:{documentId:doc.id,action:'document.updated'}});expect(audit.beforeValue).toHaveProperty('items');expect(audit.afterValue).toHaveProperty('items');
    await submitDocument(user,doc.id);expect(await db.notification.count({where:{documentId:doc.id,template:'review_pending',status:'MOCKED'}})).toBeGreaterThan(0);
  });
});
