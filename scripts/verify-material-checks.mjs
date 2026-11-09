// Actual UI in an isolated browser with intercepted synthetic API responses.
// Does not start a server, contact the trial site, or establish backend persistence.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const out=path.resolve('.data/material-checks-20261103');
await mkdir(out,{recursive:true});
const bundle=await build({entryPoints:['tests/ui/compact-review-entry.tsx'],bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[...(process.env.CHECKS_BASELINE === '1' ? [{name:'previous-page',setup(b){b.onLoad({filter:/documents[\\/]\[id\][\\/]page\.tsx$/},async()=>({loader:'tsx',contents:(await import('node:child_process')).execFileSync('git',['show','e275ee1b6f92736a18600db14336f3f4edc947a4:src/app/(workspace)/documents/[id]/page.tsx'],{encoding:'utf8'}),resolveDir:path.resolve('src/app/(workspace)/documents/[id]')}));}}] : []),{
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
const results=[],errors=[];
const makeCheck=(type,extra={})=>({id:type,itemId:'line-0',type,dimension:'主数据匹配',severity:'ERROR',status:'OPEN',title:type,detail:type,expectedValue:null,actualValue:null,...extra});
try{
 for(const width of [390,1440]) for(const mode of ['create','choose','other-error','failed-create']){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'zh-CN'});
  const page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  let doc=structuredClone(original),patches=[],creates=[];
  doc.items[0]={...doc.items[0],ingredientId:null,matchStatus:'UNMATCHED',confidence:mode==='create'?.7:1,unit:'',spec:''};
  doc.checks=[makeCheck('ingredient_unmatched'),makeCheck('unit_missing'),...(mode==='other-error'?[makeCheck('contract_price')]:[])];
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=u.pathname,method=route.request().method();
   const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(p==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:js});
   if(p==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
   if(p==='/fixture.svg')return route.fulfill({contentType:'image/svg+xml',body:await readFile('public/sample-delivery.svg','utf8')});
   if(p==='/api/bootstrap')return json(bootstrap);
   if(p==='/api/documents/fixture'){
    if(method==='PATCH'){
     const body=route.request().postDataJSON();assert.equal(body.version,doc.version,'version from create must be retained');patches.push(body);
     doc={...doc,...body,version:doc.version+1,checks:doc.checks.filter(c=>!['ingredient_unmatched','unit_missing'].includes(c.type))};return json({document:doc});
    }
    return json({document:doc,audit:[],approvals:[]});
   }
   if(p==='/api/master-data/ingredients'&&method==='POST'){
    creates.push(route.request().postDataJSON());
    if(mode==='failed-create')return json({error:'模拟新建失败'},500);
    const created={id:'created-material',name:'上海青',unit:'斤',spec:'斤',documentVersion:doc.version+1};
    doc={...doc,version:created.documentVersion,items:doc.items.map((item,i)=>i?item:{...item,...created,id:item.id,ingredientId:created.id,matchStatus:'MATCHED',matchScore:1}),checks:doc.checks.filter(c=>!['ingredient_unmatched','unit_missing'].includes(c.type))};
    return json(created,201);
   }
   if(p==='/api/master-data/suggest')return json({suggestions:[]});
   if(p==='/api/master-data/ingredients'||p==='/api/master-data/frequent')return json({items:ingredients,total:ingredients.length,units:['斤']});
   if(p.startsWith('/api/'))return json({});
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.fixtureUser=${JSON.stringify(user)}</script><script src="/fixture.js"></script></body></html>`});
  });
  await page.goto('https://material-ui.invalid/documents/fixture');await page.locator('[data-line-id="line-0"]').waitFor();
  const row=()=>page.locator('[data-line-id="line-0"]');
  assert.equal(await row().getByText('待处理',{exact:true}).count(),1);
  const open=()=>width<768?row().locator('.compact-line-button').click():row().locator('.ledger-material').click();
  await open();
  // Preserve an unrelated, unsaved change to another row across the create request.
  await page.getByRole('button',{name:'下一行',exact:true}).click();await page.getByRole('spinbutton',{name:'第2项数量',exact:true}).fill('12.3456');
  await page.getByRole('button',{name:'上一行',exact:true}).click();
  if(mode==='choose'){
   await page.getByRole('button',{name:'更换材料',exact:true}).click();await page.locator('.picker-result').first().waitFor();await page.locator('.picker-result').first().click();
  }else{
   await page.getByRole('button',{name:'新建品名',exact:true}).click();
   await page.getByPlaceholder('如 kg / 袋 / 桶').fill('斤');await page.getByRole('button',{name:'确认新建',exact:true}).click();
   if(mode==='failed-create'){
    await page.getByText('模拟新建失败',{exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'完成本行',exact:true}).click();
    assert.equal(await row().getByText('待处理',{exact:true}).count(),1);assert.equal(patches.length,0);results.push({width,mode,result:'PASS'});await ctx.close();continue;
   }
   await page.getByText('原材料已新建并关联到当前明细，请保存单据',{exact:true}).waitFor();assert.equal(creates[0].sourceItemId,'line-0');
  }
  await page.getByRole('button',{name:'完成本行',exact:true}).click();
  assert.equal(await row().getByText('待处理',{exact:true}).count(),mode==='other-error'?1:0,'resolved matching must not leave a stale pending badge');
  if(mode==='create')assert.equal(await row().getByText('核对原单',{exact:true}).count(),1,'OCR confidence remains independent');
  assert.equal(patches.length,0,'finishing a row must not silently save other edits');
  assert(!(await page.locator('body').innerText()).includes('ingredient_unmatched'));
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('修改已保存，比对结果已刷新',{exact:true}).waitFor();
  assert.equal(patches[0].items[1].quantity,12.3456,'other unsaved edits preserved');assert(patches[0].items[0].ingredientId);
  assert.equal(await row().getByText('待处理',{exact:true}).count(),mode==='other-error'?1:0);
  await page.reload();await row().waitFor();assert.equal(await row().getByText('待处理',{exact:true}).count(),mode==='other-error'?1:0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`${mode}-${width}.png`)});results.push({width,mode,result:'PASS'});await ctx.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'browser-result.json'),JSON.stringify({mode:'ACTUAL_COMPONENTS_SYNTHETIC_API',results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser.close();}
