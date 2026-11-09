// Run after stopping the isolated web process, so PGlite has a single owner.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { getReadyDb } from '@/lib/bootstrap';
const output='D:/codex/gysycl/docs/acceptance-2026-10-22';
const {refs}=JSON.parse(await fs.readFile(`${output}/api-results.json`,'utf8'));
const db=await getReadyDb();
const flow=await db.document.findUniqueOrThrow({where:{id:refs.flow},include:{auditLogs:true}});
const audit=await db.auditLog.findMany({where:{documentId:refs.flow,action:'document.updated'},orderBy:{createdAt:'asc'}});
assert(audit.length>=3);assert(audit.every(a=>a.beforeValue&&a.afterValue));
const notices=await db.notification.findMany({where:{documentId:{in:[refs.flow,refs.override]}}});
assert(notices.some(n=>n.template==='review_pending'));assert(notices.some(n=>n.template==='review_result'));assert(notices.every(n=>n.status==='MOCKED'));
const zero=await db.document.findUniqueOrThrow({where:{id:refs.zeroTotal},include:{items:true}});
assert.equal(zero.status,'APPROVED');assert.equal(Number(zero.totalAmount),0);assert.equal(Number(zero.subtotal),42);
const result={restartRead:'PASS',flow:{id:flow.id,status:flow.status,version:flow.version},audit:{updates:audit.length,hasBeforeAndAfter:true},notifications:{total:notices.length,statuses:[...new Set(notices.map(n=>n.status))],templates:[...new Set(notices.map(n=>n.template))]},zeroTotalDefectPersisted:{id:zero.id,status:zero.status,subtotal:Number(zero.subtotal),totalAmount:Number(zero.totalAmount)},counts:{documents:await db.document.count(),items:await db.documentItem.count()}};
await fs.writeFile(`${output}/persistence-results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await db.$disconnect();process.exit(0);
