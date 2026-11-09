// Actual UI in an isolated browser with intercepted synthetic API responses.
// Does not start a server, contact the trial site, or establish backend persistence.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const out=path.resolve('.data/compact-editor-20261102');
await mkdir(out,{recursive:true});
const bundle=await build({entryPoints:['tests/ui/compact-review-entry.tsx'],bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
 name:'fixture-next-navigation',setup(b){
  b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:a.path.endsWith('/link')?'import React from "react"; export default function Link(props){return <a {...props}/>;}':'const router={push(){},replace(){},refresh(){},back(){}}; export const useRouter=()=>router; export const usePathname=()=>"/documents/fixture"; export const useParams=()=>({id:"fixture"});',resolveDir:process.cwd()}));
 }}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const user={id:'demo-admin',employeeNo:'demo',name:'演示管理员',globalRole:'ADMIN',memberships:[]};
const names=['上海青','西红柿','土豆','黄瓜','胡萝卜','鸡蛋','大白菜','鲜香菇','洋葱','猪里脊','青椒','冬瓜','菠菜','茄子','红薯','豆腐','莴笋','花菜','西兰花','小葱'];
const ingredients=names.map((name,i)=>({id:'ing-'+i,name,unit:'斤',spec:'斤',category:'蔬菜',aliases:[]}));
const supplier={id:'supplier',name:'演示·鲜禾配送',contactName:'',contactPhone:''};
const bootstrap={user,projects:[{id:'project',code:'DEMO',name:'演示项目',region:'华东'}],suppliers:[supplier],ingredients,contracts:[],system:{ocrMode:'mock',confidenceThreshold:.9,wechatConfigured:false,storageDriver:'local',thresholds:{}}};
const original={id:'fixture',docNo:'DEMO-UI-001',docDate:'2026-11-02',projectId:'project',projectName:'演示项目',supplierId:supplier.id,supplierName:supplier.name,ocrSupplierName:supplier.name,supplierMatchStatus:'MATCHED',supplierMatchScore:1,status:'DRAFT',visibility:{unitPrice:true,amount:true,contractPrice:true,others:true,sourceImages:true,sensitiveDetails:true},subtotal:1200,taxAmount:0,totalAmount:1200,notes:'',reviewNote:'',overrideReason:'',version:1,ocrError:'',ocrWarnings:[],createdById:user.id,submittedAt:null,reviewedAt:null,createdAt:'2026-11-02T00:00:00.000Z',items:ingredients.map((x,i)=>({...x,id:'line-'+i,lineNo:i+1,rawName:x.name,quantity:10,unitPrice:6,amount:60,confidence:1,sourcePageNo:i<10?1:2,ingredientId:x.id,matchStatus:'MATCHED',matchScore:1})),pages:[1,2].map(n=>({id:'page-'+n,pageNo:n,fileName:'演示原单-'+n+'.svg',url:'/fixture.svg',status:'DONE',width:800,height:1100,sourceDocNo:'',sourceDocDate:''})),checks:[]};
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const errors=[],widths=[375,390,430,1440],results=[];
try {
 for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<768,hasTouch:width<768,locale:'zh-CN'});
  let doc=structuredClone(original),patches=[];
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   const json=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   if(p==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:js});
   if(p==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
   if(p==='/fixture.svg')return route.fulfill({contentType:'image/svg+xml',body:await readFile('public/sample-delivery.svg','utf8')});
   if(p==='/api/bootstrap')return json(bootstrap);
   if(p==='/api/documents/fixture'){
    if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();patches.push(body);doc={...doc,...body,version:doc.version+1};return json({document:doc});}
    return json({document:doc,audit:[],approvals:[]});
   }
   if(p==='/api/master-data/suggest')return json({suggestions:u.searchParams.get('type')==='supplier'?[{...supplier,score:1,matchStatus:'MATCHED'}]:ingredients.map(x=>({...x,score:1,matchStatus:'MATCHED'}))});
   if(p==='/api/master-data/ingredients'||p==='/api/master-data/frequent')return json({items:ingredients,total:ingredients.length,units:['斤']});
   if(p.startsWith('/api/'))return json({});
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.fixtureUser=${JSON.stringify(user)}</script><script src="/fixture.js"></script></body></html>`});
  });
  await page.goto('https://compact-ui.invalid/documents/fixture');
  await page.locator('.compact-document-meta').waitFor();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow '+width);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()),'#76543e');
  const visibleRows=await page.locator(width<768?'.compact-line':'.compact-item-table tbody tr').evaluateAll(rows=>rows.filter(row=>{const r=row.getBoundingClientRect(),bottom=document.querySelector('.ledger-actions').getBoundingClientRect().top;return r.top>=0&&r.bottom<=bottom;}).length);
  await page.screenshot({path:path.join(out,`actual-list-${width}.png`)});
  const openFirst=()=>width<768?page.locator('.compact-line-list [data-field="quantity"]').first().click():page.getByRole('button',{name:'第1项数量',exact:true}).click();
  await openFirst();const dialog=page.getByRole('dialog',{name:'第 1 行 · 上海青',exact:true});await dialog.waitFor();
  assert.equal(await page.getByRole('spinbutton',{name:'第1项数量',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.getByRole('spinbutton',{name:'第1项数量',exact:true}).fill('12.5');
  await page.getByRole('spinbutton',{name:'第1项单价',exact:true}).fill('6.1234');
  await page.getByRole('button',{name:'下一行',exact:true}).click();
  await page.getByRole('button',{name:'上一行',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'第1项单价',exact:true}).inputValue(),'6.1234');
  assert.equal(await page.getByRole('spinbutton',{name:'第1项行金额',exact:true}).inputValue(),'76.54');
  await page.getByRole('spinbutton',{name:'第1项行金额',exact:true}).fill('76.5');
  await page.getByRole('button',{name:'确认第1项为抹零',exact:true}).click();
  await page.getByRole('button',{name:'更换材料',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'第1项单价',exact:true}).inputValue(),'6.1234');
  await page.getByRole('button',{name:'新建品名',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'第1项单价',exact:true}).inputValue(),'6.1234');
  await page.getByRole('button',{name:'查看第 1 页原图',exact:true}).click();
  await page.getByRole('button',{name:'关闭原图',exact:true}).click();
  await dialog.waitFor();assert.equal(await page.getByRole('spinbutton',{name:'第1项行金额',exact:true}).inputValue(),'76.50');
  await page.screenshot({path:path.join(out,`actual-sheet-${width}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'完成本行',exact:true}).click();assert.equal(patches.length,0);
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.getByText('修改已保存，比对结果已刷新',{exact:true}).waitFor();
  assert.equal(patches.length,1);assert.equal(patches[0].items[0].quantity,12.5);assert.equal(patches[0].items[0].unitPrice,6.1234);assert.equal(patches[0].items[0].roundingConfirmed,true);
  await page.locator('.compact-document-meta').click();const search=page.getByRole('textbox',{name:'搜索供应商',exact:true});await search.fill('鲜');await page.locator('.candidate-item').first().waitFor();await page.waitForTimeout(4600);assert.equal(await search.inputValue(),'鲜');assert((await page.locator('.candidate-item').count())>0);await page.getByRole('button',{name:'关闭编辑面板',exact:true}).click();
  await openFirst();await page.keyboard.press('Escape');assert.equal(await page.locator('.editor-sheet').count(),0);
  if(width===390){
   page.on('dialog',d=>d.accept());
   await page.getByRole('button',{name:'增加一行',exact:true}).click();
   await page.getByRole('spinbutton',{name:'第21项数量',exact:true}).waitFor();
   await page.getByRole('button',{name:'删除第21项',exact:true}).click();
   assert.equal(await page.locator('.editor-sheet').count(),0);assert.equal(await page.locator('.compact-line').count(),20);
   await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.waitForResponse(r=>r.url().endsWith('/api/documents/fixture')&&r.request().method()==='GET');
   doc={...doc,visibility:{...doc.visibility,unitPrice:false,amount:false,sourceImages:false,sensitiveDetails:false},subtotal:null,taxAmount:null,totalAmount:null,pages:[],items:doc.items.map(x=>({...x,unitPrice:null,amount:null}))};
   await page.reload();await page.locator('.compact-line').first().waitFor();await openFirst();
   assert.equal(await page.getByRole('spinbutton',{name:'第1项单价',exact:true}).count(),0);
   assert.equal(await page.getByRole('spinbutton',{name:'第1项行金额',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:/查看第.*页原图/}).count(),0);
   assert(!(await page.locator('body').innerText()).includes('6.1234'));
   await page.screenshot({path:path.join(out,'actual-restricted-390.png')});
   await page.keyboard.press('Escape');doc={...doc,status:'APPROVED'};
   await page.reload();await page.locator('.compact-line').first().waitFor();await openFirst();
   assert.equal(await page.getByRole('spinbutton',{name:'第1项数量',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'更换材料',exact:true}).count(),0);
   await page.keyboard.press('Escape');doc={...structuredClone(original),status:'PENDING_REVIEW'};
   await page.reload();await page.locator('.ledger-actions--review').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(out,'actual-review-390.png')});
  }
  results.push({width,visibleRows,sheetAndNavigation:'PASS',decimalRoundingAndMockSave:'PASS',supplierSearch:'PASS'});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'browser-result.json'),JSON.stringify({mode:'ACTUAL_COMPONENTS_MOCKED_API_NO_SERVER',results,errors},null,2));
 console.log(JSON.stringify({results,errors}));
}finally{await browser.close();}
