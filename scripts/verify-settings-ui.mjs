// Uses production components and synthetic, intercepted APIs. No server mutations.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const out=path.resolve('.data/ui-maintenance-20261103');await mkdir(out,{recursive:true});
const built=await build({entryPoints:['tests/ui/settings-entry.tsx'],bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'next-fixture',setup(b){
 b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path.endsWith('/link')?'import React from "react";export default function Link(p){return <a {...p}/>;}':'export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>location.pathname;'}));
}}]});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
const user={id:'admin',name:'演示管理员',employeeNo:'DEMOADMIN',globalRole:'ADMIN',active:true,memberships:[]};
const staff={...user,id:'staff',name:'测试员工',employeeNo:'DEMOSTAFF',globalRole:'STAFF',wechatBound:false,memberships:[]};
const bootstrap={user,projects:[{id:'project',name:'演示项目',code:'DEMO',region:''}],suppliers:[],ingredients:[],contracts:[],system:{ocrMode:'mock',storageDriver:'oss',thresholds:{}}};
const svg=await readFile('public/sample-delivery.svg','utf8');
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const results=[],errors=[];
try{for(const width of [375,390,430,768,1024,1440]){
 const context=await browser.newContext({viewport:{width,height:900},locale:'zh-CN'});const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 let users=[{...user,wechatBound:false},staff],deleted=0,queries=[],unexpected=[];
 await context.route('**/*',async r=>{const u=new URL(r.request().url()),p=u.pathname,m=r.request().method();const json=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if(p==='/fixture.js')return r.fulfill({contentType:'text/javascript',body:js});if(p==='/fixture.css')return r.fulfill({contentType:'text/css',body:css});
  if(p==='/fixture.svg'||p==='/retry.svg'&&u.searchParams.has('retry'))return r.fulfill({contentType:'image/svg+xml',body:svg});
  if(p==='/retry.svg')return r.fulfill({status:503,body:'Temporary fixture failure'});
  if(p==='/api/bootstrap')return json(bootstrap);if(p==='/api/roles')return json({roles:[]});
  if(p==='/api/users')return json({users});if(p==='/api/users/staff'&&m==='DELETE'){deleted++;users=users.filter(x=>x.id!=='staff');return json({id:'staff',deleted:true});}
  if(p==='/api/documents'){queries.push(u.searchParams.get('q'));return json({documents:[{id:'fixture',docNo:'DEMO-1',docDate:'2026-11-03',projectId:'project',projectName:'演示项目',supplierName:'测试供应商',status:'DRAFT',itemCount:4,totalAmount:525,errorCount:0,warningCount:0,previewImageUrl:'/fixture.svg'}]});}
  if(p.startsWith('/api/')){unexpected.push(p);return json({});}
  return r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.fixtureUser=${JSON.stringify(user)}</script><script src="/fixture.js"></script></body></html>`});
 });
 const noOverflow=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+' '+width);
 await page.goto('https://fixture.invalid/settings');await page.locator('.settings-category').last().waitFor();assert.equal(await page.locator('.settings-category').count(),4);assert.equal(await page.locator('form').count(),0);await noOverflow('settings');
 for(const title of ['项目点','角色权限','企业品牌','员工账号']){await page.locator('.settings-category').filter({hasText:title}).click();await page.getByRole('dialog',{name:title,exact:true}).waitFor();await noOverflow(title);await page.screenshot({path:path.join(out,`settings-${title}-${width}.png`)});await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);}
 await page.locator('.settings-category').filter({hasText:'员工账号'}).click();const self=page.getByRole('row').filter({hasText:'DEMOADMIN'}),target=page.getByRole('row').filter({hasText:'DEMOSTAFF'});
 assert.equal(await self.getByRole('button',{name:'删除账号',exact:true}).isDisabled(),true);
 await target.getByRole('button',{name:'删除账号',exact:true}).click();await page.getByRole('dialog',{name:'删除员工账号',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(deleted,0);assert.equal(await page.getByRole('dialog').count(),1);
 await target.getByRole('button',{name:'重置密码',exact:true}).click();await page.getByRole('dialog',{name:'重置密码：测试员工',exact:true}).waitFor();await page.keyboard.press('Escape');
 await target.getByRole('button',{name:'删除账号',exact:true}).click();await page.getByRole('button',{name:'确认删除账号',exact:true}).click();await target.waitFor({state:'detached'});assert.equal(deleted,1);await page.keyboard.press('Escape');await noOverflow('after-delete');
 await page.goto('https://fixture.invalid/documents');const input=page.getByRole('textbox',{name:'搜索原材料、供应商、项目点或单号',exact:true});await input.fill('鸡蛋');await page.getByRole('button',{name:'查询',exact:true}).click();await page.waitForTimeout(150);assert(queries.includes('鸡蛋'));await page.locator('.document-preview-link img').waitFor();assert(await page.locator('.document-preview-link img').evaluate(i=>i.complete&&i.naturalWidth>0));await noOverflow('documents');await page.screenshot({path:path.join(out,`documents-${width}.png`)});
 if(width<768)assert((await page.locator('.document-preview-link').boundingBox()).height<100,'supplier readable as horizontal text');
 await page.goto('https://fixture.invalid/image');await page.getByRole('button',{name:'重新加载图片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('img[alt="测试原单"]')?.naturalWidth>0);assert.equal(await page.getByText('图片暂未加载成功',{exact:true}).count(),0);assert.deepEqual(unexpected,[]);
 results.push({width,categories:4,dialogs:'PASS',deleteConfirmationAndSelfProtection:'PASS',passwordModal:'PASS',materialSearch:'PASS',imageRetry:'PASS',rootOverflow:false});await context.close();
}assert.deepEqual(errors,[]);await writeFile(path.join(out,'browser-result.json'),JSON.stringify({mode:'ACTUAL_COMPONENTS_SYNTHETIC_API',results,errors},null,2));console.log(JSON.stringify({results,errors}));}finally{await browser.close();}
