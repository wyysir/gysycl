import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
const base='http://localhost:3107',out=new URL('./',import.meta.url),results=[];
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({employeeNo:'admin',password:'admin123'})});
assert.equal(login.status,200);const cookie=login.headers.getSetCookie()[0].split(';')[0];
async function get(path,binary=false){const r=await fetch(base+path,{headers:{Cookie:cookie},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return binary?Buffer.from(await r.arrayBuffer()):r.json();}
async function test(id,name,fn){try{const evidence=await fn();results.push({id,name,status:'PASS',evidence});}catch(e){results.push({id,name,status:'FAIL',actual:e.message});}}
const list=(await get('/api/documents?limit=200')).documents;
const details=[];for(const d of list)details.push((await get('/api/documents/'+d.id)).document);
await test('I01','Excel单据、明细和异常逐行与详情数据勾稽',async()=>{
 const bytes=await get('/api/export/documents',true);await fs.writeFile(new URL('documents-export.xlsx',out),bytes);
 const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);const [summary,items,checks]=w.worksheets;
 assert.equal(summary.actualRowCount-1,details.length);assert.equal(items.actualRowCount-1,details.reduce((n,d)=>n+d.items.length,0));assert.equal(checks.actualRowCount-1,details.reduce((n,d)=>n+d.checks.length,0));
 const expectedItems=details.flatMap(d=>d.items.map(i=>[d.docDate,d.docNo,d.projectName,d.supplierName,i.name,i.spec,i.unit,i.quantity,i.unitPrice,i.amount,i.confidence]));
 const actualItems=[];items.eachRow((row,n)=>{if(n>1)actualItems.push(Array.from({length:11},(_,i)=>row.getCell(i+1).value??''));});
 assert.deepEqual(actualItems.map(JSON.stringify).sort(),expectedItems.map(JSON.stringify).sort());
 const expectedChecks=details.flatMap(d=>d.checks.map(c=>[d.docDate,d.docNo,d.projectName,c.dimension,c.severity,c.title,c.detail,c.expectedValue??'',c.actualValue??'']));
 const actualChecks=[];checks.eachRow((row,n)=>{if(n>1)actualChecks.push(Array.from({length:9},(_,i)=>row.getCell(i+1).value??''));});assert.deepEqual(actualChecks.map(JSON.stringify).sort(),expectedChecks.map(JSON.stringify).sort());
 return {documents:details.length,items:expectedItems.length,checks:expectedChecks.length};
});
await test('I02','价格分析项目和供应商汇总与已通过单据一致',async()=>{
 const a=await get('/api/analytics?from=2026-09-01&to=2026-10-31');const approved=details.filter(d=>d.status==='APPROVED'&&d.docDate>='2026-09-01'&&d.docDate<='2026-10-31');
 const total=approved.reduce((s,d)=>s+d.totalAmount,0);assert(Math.abs(a.projectSpend.reduce((s,p)=>s+p.amount,0)-total)<0.001);assert(Math.abs(a.supplierSpend.reduce((s,p)=>s+p.amount,0)-total)<0.001);
 for(const p of a.projectSpend)assert(Math.abs(p.amount-approved.filter(d=>d.projectName===p.name).reduce((s,d)=>s+d.totalAmount,0))<0.001);
 await fs.writeFile(new URL('analytics-snapshot.json',out),JSON.stringify(a,null,2));return {approved:approved.length,total};
});
await test('I03','规范品名规格单位分组与跨供应商价格矩阵勾稽',async()=>{
 const a=await get('/api/analytics?from=2026-09-01&to=2026-10-31');const approved=details.filter(d=>d.status==='APPROVED'&&d.docDate>='2026-09-01'&&d.docDate<='2026-10-31');
 for(const m of a.priceMatrix){const samples=approved.flatMap(d=>d.items.filter(i=>i.name===m.ingredient&&i.spec===m.spec&&i.unit===m.unit).map(i=>({price:i.unitPrice,supplier:d.supplierName,project:d.projectName})));
  for(const [supplier,s] of Object.entries(m.suppliers)){const prices=samples.filter(x=>x.supplier===supplier).map(x=>x.price);assert.equal(s.samples,prices.length);assert.equal(s.minPrice,Math.min(...prices));assert.equal(s.maxPrice,Math.max(...prices));}
 }
 const multi=a.priceMatrix.filter(m=>Object.keys(m.suppliers).length>1);assert(multi.length>0);return {groups:a.priceMatrix.length,multiSupplierGroups:multi.length};
});
await fs.writeFile(new URL('reconciliation-results.json',out),JSON.stringify({results,summary:{total:results.length,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length}},null,2));
console.log(JSON.stringify(results,null,2));process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
