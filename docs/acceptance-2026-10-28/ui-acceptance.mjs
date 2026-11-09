import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const base='http://localhost:3107', out=import.meta.dirname;
const browser=await chromium.launch({headless:true,channel:'msedge'});
const results=[],errors=[],failedResponses=[];
async function check(name,fn){try{const evidence=await fn();results.push({name,status:'PASS',evidence});}catch(error){results.push({name,status:'FAIL',error:error.message});}console.log(results.at(-1).status,name);await fs.writeFile(path.join(out,'ui-results.json'),JSON.stringify({results,errors,failedResponses},null,2));}
const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',locale:'zh-CN'});
const page=await context.newPage();
function monitor(p){p.on('pageerror',e=>errors.push({url:p.url(),message:e.message}));p.on('response',r=>{if(r.status()>=500)failedResponses.push({url:r.url(),status:r.status()});});}
monitor(page);
async function login(p,employee,password){await p.goto(base+'/login',{waitUntil:'networkidle'});await p.getByLabel('员工号').fill(employee);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录系统',exact:true}).click();}
await check('错误密码留在登录表单并显示真实错误',async()=>{
  await login(page,'admin','wrong-password');
  await page.getByText('工号或密码错误',{exact:true}).waitFor();
  await page.waitForTimeout(500);
  assert.equal(new URL(page.url()).search,'');
  assert(await page.getByText('工号或密码错误',{exact:true}).isVisible());
});
await check('管理员表单登录',async()=>{await login(page,'admin','admin123');await page.waitForURL('**/dashboard');await page.waitForLoadState('networkidle');await page.locator('h1').waitFor();assert(await page.locator('h1').isVisible());});
for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  for(const route of ['/dashboard','/documents','/documents/doc_demo_002','/upload','/reviews','/analytics','/master']){
    await check(`${label} ${route}`,async()=>{
      await page.goto(base+route,{waitUntil:'networkidle'});
      await page.locator('h1').first().waitFor();
      const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
      assert(geometry.document<=geometry.viewport+1,JSON.stringify(geometry));
      assert.equal(new URL(page.url()).pathname,route);
      await page.screenshot({path:path.join(out,`ui-${label}-${route.replaceAll('/','_')}.png`),fullPage:true});
      return geometry;
    });
  }
}
await page.setViewportSize({width:390,height:844});
await check('手机选择图片、上传、OCR轮询和草稿保存',async()=>{
  await page.goto(base+'/upload',{waitUntil:'networkidle'});
  const buffer=await sharp({create:{width:432,height:600,channels:3,background:'#f3f1e6'}}).png().toBuffer();
  await page.getByLabel('从相册选择送货单',{exact:true}).setInputFiles({name:'browser-delivery.png',mimeType:'image/png',buffer});
  assert(await page.locator('.upload-thumb').count()===1);
  await page.getByRole('button',{name:'上传并开始识别',exact:true}).click();
  await page.waitForURL(/\/documents\/[^/]+$/);
  await page.locator('.cell-input--name').first().waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.cell-input--name').length===2);
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByText('修改已保存，比对结果已刷新',{exact:true}).waitFor();
  const id=new URL(page.url()).pathname.split('/').at(-1);
  const detail=await (await context.request.get(base+'/api/documents/'+id)).json();
  assert.equal(detail.document.items.length,2);assert.equal(detail.document.ocrError,'');
  await page.screenshot({path:path.join(out,'ui-mobile-upload-result.png'),fullPage:true});
  return {id,status:detail.document.status};
});
await check('财务页面只读并隐藏上传和审核入口',async()=>{
  const c=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
  const p=await c.newPage();monitor(p);await login(p,'finance','finance123');await p.waitForURL('**/dashboard');
  await p.goto(base+'/documents/doc_demo_002',{waitUntil:'networkidle'});
  assert.equal(await p.getByRole('button',{name:'保存修改',exact:true}).count(),0);
  assert.equal(await p.locator('a[href="/upload"]').count(),0);
  assert.equal(await p.locator('a[href="/reviews"]').count(),0);
  assert(await p.locator('.cell-input--name').first().isDisabled());await c.close();
});
await check('页面运行无未捕获异常和5xx响应',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[]);});
await context.close();await browser.close();
const summary={total:results.length,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length};
await fs.writeFile(path.join(out,'ui-results.json'),JSON.stringify({summary,results,errors,failedResponses},null,2));console.log(summary);process.exitCode=summary.failed?1:0;
