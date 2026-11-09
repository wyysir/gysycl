// Actual UI, isolated synthetic APIs. Backend persistence has separate tests.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const out=path.resolve('.data/batch-verification-20261104');await mkdir(out,{recursive:true});
const bundle=await build({entryPoints:['tests/ui/batch-entry.tsx'],bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-next',setup(b){
  b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:a.path.endsWith('/link')?'import React from "react";export default function Link(p){return <a {...p}/>;}':'const router={push(p){window.fixtureDestination=p},replace(){},refresh(){},back(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;',resolveDir:process.cwd()}));
}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const user={id:'fixture-admin',name:'演示管理员',employeeNo:'demo',globalRole:'ADMIN',memberships:[]};
const names=['上海青','西红柿','土豆','黄瓜','鲜香菇','鸡蛋','大白菜','胡萝卜'];
const ingredients=names.map((name,i)=>({id:'material-'+i,name,unit:'斤',spec:'斤',category:'蔬菜',aliases:[]}));
const bootstrap={user,projects:[{id:'project',name:'演示·妇保院',code:'FBY',region:'浙江'}],suppliers:[],ingredients,contracts:[],system:{ocrMode:'mock',confidenceThreshold:.9,wechatConfigured:false,storageDriver:'local',thresholds:{}}};
function documents(){return Array.from({length:10},(_,i)=>({id:'doc-'+i,batchId:'fixture',batchPosition:i+1,checkedVersion:i<2?1:null,checkedAt:null,
  docNo:'SHD-20261104-SYNTHETIC-'+i,docDate:'2026-11-04',projectId:'project',projectName:'演示·妇保院',supplierId:i===2?null:i<6?'supplier-a':'supplier-b',supplierName:i<6?'演示·鲜禾蔬菜配送':'演示·兴盛副食品',ocrSupplierName:i<6?'演示·鲜禾蔬菜配送':'演示·兴盛副食品',supplierMatchStatus:i===2?'UNMATCHED':'MATCHED',supplierMatchScore:1,
  status:'DRAFT',visibility:{unitPrice:true,amount:true,contractPrice:true,others:true,sourceImages:true,sensitiveDetails:true},subtotal:96,taxAmount:0,totalAmount:96,notes:'',reviewNote:'',overrideReason:'',version:1,ocrError:'',createdById:user.id,submittedAt:null,reviewedAt:null,createdAt:'2026-11-04T08:00:00Z',
  items:ingredients.map((m,n)=>({...m,id:`line-${i}-${n}`,lineNo:n+1,rawName:m.name,quantity:2,unitPrice:6,amount:12,confidence:i===2&&n===0?.7:1,sourcePageNo:1,ingredientId:i===2&&n===0?null:m.id,matchStatus:i===2&&n===0?'UNMATCHED':'MATCHED',matchScore:1})),
  pages:[{id:'page-'+i,pageNo:1,fileName:'演示单据.png',url:'/fixture.svg',status:'COMPLETED',width:800,height:1100,sourceDocDate:i%2?'2026-11-04':''}],
  checks:i===2?[{id:'match',itemId:'line-2-0',dimension:'材料',type:'ingredient_unmatched',severity:'ERROR',status:'OPEN',title:'原材料未匹配',detail:'请关联或新建',expectedValue:null,actualValue:null}]:[],
}));}
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),results=[],errors=[];
try{for(const width of [375,390,430,1440]){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'zh-CN'}),page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  let docs=documents(),patches=[],submissions=[],failedPatch=true,created=0;
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,method=req.method();const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(p==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:js});if(p==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
    if(p==='/fixture.svg')return route.fulfill({contentType:'image/svg+xml',body:await readFile('public/sample-delivery.svg','utf8')});
    if(p==='/api/bootstrap')return json(bootstrap);
    if(p==='/api/batches')return json({batches:[]});
    if(p==='/api/batches/fixture'){
      if(method==='POST'){const body=req.postDataJSON();
        if(body.action==='confirm'){const d=docs.find(d=>d.id===body.documentId);assert.equal(body.version,d.version);d.version++;d.checkedVersion=d.version;return json({document:d});}
        if(body.action==='submit'){submissions.push(body);const rs=body.documents.map((entry,i)=>{const d=docs.find(d=>d.id===entry.id);if(i===0){d.status='PENDING_REVIEW';d.version++;}return{id:d.id,ok:i===0,message:i===0?'已提交审核':'模拟冲突，请重新核对'};});return json({results:rs});}
      }
      return json({id:'fixture',projectId:'project',projectName:'演示·妇保院',docDate:'2026-11-04',createdAt:'2026-11-04T08:00:00Z',canUpload:true,photos:docs.map(d=>({position:d.batchPosition,fileName:'演示单据.png',documentId:d.id,deleted:false})),documents:docs});
    }
    if(p.startsWith('/api/documents/')&&method==='PATCH'){
      const body=req.postDataJSON(),d=docs.find(d=>d.id===p.split('/').at(-1));patches.push(body);
      if(failedPatch){failedPatch=false;return json({error:'模拟断网，修改仍保留'},503);}
      assert.equal(body.version,d.version);Object.assign(d,body,{version:d.version+1,checkedVersion:null,items:body.items.map((i,n)=>({...i,id:`saved-${d.id}-${d.version+1}-${n}`})),checks:[]});return json({document:d});
    }
    if(p==='/api/master-data/ingredients'&&method==='POST'){
      const body=req.postDataJSON(),d=docs.find(d=>d.id===body.sourceDocumentId);d.version++;const c={id:'created-'+(++created),name:body.name,unit:body.unit,spec:body.unit,documentVersion:d.version};
      d.items=d.items.map(i=>i.id===body.sourceItemId?{...i,name:c.name,unit:c.unit,ingredientId:c.id,matchStatus:'MATCHED'}:i);d.checks=[];return json(c,201);
    }
    if(p==='/api/master-data/suggest')return json({suggestions:[]});
    if(p==='/api/master-data/ingredients')return json({items:ingredients,total:ingredients.length,units:['斤']});
    if(p.startsWith('/api/'))return json({});
    return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.fixtureBootstrap=${JSON.stringify(bootstrap)}</script><script src="/fixture.js"></script></body></html>`});
  });
  await page.goto('https://batch-ui.invalid/batches/fixture');await page.locator('#document-doc-0').waitFor();
  assert.equal(await page.locator('.batch-document').count(),10);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`review-${width}.png`)});
  const open=async (doc,index)=>{const row=page.locator(`#document-${doc} [data-line-id]`).nth(index);await row.locator(width<768?'.compact-line-button':'.ledger-material').click();};
  await open('doc-0',0);let dialog=page.getByRole('dialog');await dialog.getByRole('spinbutton',{name:'第1项数量',exact:true}).fill('3');
  assert.equal(Number(await dialog.getByRole('spinbutton',{name:'第1项行金额',exact:true}).inputValue()),12);
  await dialog.getByRole('spinbutton',{name:'第1项行金额',exact:true}).fill('18');
  await page.screenshot({path:path.join(out,`edit-${width}.png`)});
  await dialog.getByRole('button',{name:'保存并下一行',exact:true}).click();
  await dialog.getByText('模拟断网，修改仍保留',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('spinbutton',{name:'第1项数量',exact:true}).inputValue(),'3');
  await dialog.getByRole('button',{name:'保存并下一行',exact:true}).click();
  await page.getByRole('dialog',{name:'第 2 行 · 西红柿',exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭编辑面板',exact:true}).click();
  await page.locator('#document-doc-0').getByRole('button',{name:'确认本单',exact:true}).click();
  await page.locator('#document-doc-0').getByRole('button',{name:'✓ 已核对',exact:true}).waitFor();
  // New material response increments the document version; unsaved edits survive polling.
  await open('doc-2',0);await page.getByRole('button',{name:'新建品名',exact:true}).click();await page.getByRole('button',{name:'确认新建并关联',exact:true}).click();
  await page.getByRole('dialog',{name:'第 1 行 · 上海青',exact:true}).waitFor();await page.waitForTimeout(2800);
  await page.getByRole('button',{name:'保存本行',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#document-doc-2 [data-line-id]').first().getByText('待处理',{exact:true}).count(),0);
  await page.getByRole('button',{name:'提交已核对的 2 张',exact:true}).click();await page.getByRole('dialog',{name:'提交结果',exact:true}).waitFor();
  await page.getByText('1 张已提交审核',{exact:true}).waitFor();await page.getByText('单据 2 · 模拟冲突，请重新核对',{exact:true}).waitFor();
  assert.equal(submissions[0].documents.length,2);assert.equal(patches[1].items[0].amount,18);assert.equal(patches[1].items[0].quantity,3);
  await page.screenshot({path:path.join(out,`result-${width}.png`)});
  await page.goto('https://batch-ui.invalid/upload');await page.getByRole('heading',{name:'拍照录入'}).waitFor();
  const file={name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE60AAAAASUVORK5CYII=','base64')};
  const album=page.locator('input[type=file][multiple]');await album.setInputFiles(Array.from({length:11},(_,i)=>({...file,name:`test-${i}.png`})));
  await page.getByText('每批最多10张，请减少所选图片后重试。',{exact:true}).waitFor();assert.equal(await page.locator('.batch-photo').count(),0);
  await album.setInputFiles(Array.from({length:10},(_,i)=>({...file,name:`test-${i}.png`})));
  assert.equal(await page.locator('.batch-photo').count(),10);await page.getByRole('button',{name:'移除第1张',exact:true}).click();assert.equal(await page.locator('.batch-photo').count(),9);
  assert.equal(await page.locator('input[capture=environment]').count(),1);await page.screenshot({path:path.join(out,`upload-${width}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);results.push({width,result:'PASS',assertions:['ten-documents','no-overflow','preserve-amount','failed-save-retained','save-next-new-ids','create-bind-version','partial-submit','eleven-rejected','ten-selected','remove-photo','camera-entry']});await ctx.close();
}assert.deepEqual(errors,[]);await writeFile(path.join(out,'ui-result.json'),JSON.stringify({mode:'ACTUAL_UI_SYNTHETIC_API',results,errors},null,2));console.log(JSON.stringify({results,errors}));}finally{await browser.close();}
