// Actual components with synthetic APIs; no server is started here.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const out=path.resolve('.data/audit-fixes-20261102');await mkdir(out,{recursive:true});
const bundle=await build({entryPoints:['tests/ui/business-entry.tsx'],bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-next',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:a.path.endsWith('/link')?'import React from "react";export default function Link(props){return <a {...props}/>;}':'export const usePathname=()=>location.pathname;export const useRouter=()=>({push(){},replace(){}});',resolveDir:process.cwd()}));}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const projects=['上海总部食堂','杭州园区食堂','苏州工厂食堂','南京医院食堂','宁波学校食堂'].map((name,i)=>({id:'p'+i,name:'测试·'+name,editToday:true,editHistory:true,approve:true,return:true,unitPrice:true}));
const daily=Array.from({length:7},(_,i)=>({date:`2026-${i<5?'10-'+(27+i):'11-0'+(i-4)}`,revenue:10000+i*500,cost:4500+i*300,pending:i===6?6300:0,profit:5500+i*200,rate:55-i*.5,documents:5}));
const business={today,projectId:'',revenueReview:{pendingCount:1,returnedCount:0},projectCards:projects.map((p,i)=>({id:p.id,name:p.name,revenue:i?12000:0,cost:4500,pending:i?0:1,returned:0})),projects,from:daily[0].date,to:today,analysisProjectCount:5,excludedProjects:0,summary:{daily,revenue:80500,cost:37800,pending:6300,incomplete:false,rate:53.04},categories:['肉禽','蔬菜','粮油','水产','蛋类','豆制品','调味'].map((name,i)=>({name,amount:[12000,9000,6000,4000,3000,2500,1300][i],pending:[2000,1500,1000,700,500,400,200][i],ratio:[31.75,23.81,15.87,10.58,7.94,6.61,3.44][i]})),revenues:projects.map((p,i)=>({id:'r'+i,projectId:p.id,date:today,amount:12000+i*100,notes:'【虚构演示数据】',version:1,status:i?'APPROVED':'PENDING_REVIEW',reviewNote:''})),sourceDifference:0};
const matrix=Array.from({length:35},(_,i)=>['青菜','西红柿','土豆','鸡蛋','豆腐','猪五花肉','鲈鱼','大米','食用油','生抽'][i%10]+(i>=10?i:'')).map((ingredient,i)=>({ingredientId:'i'+i,ingredient,spec:'斤',unit:'斤',projects:Object.fromEntries(projects.map((p,j)=>[p.id,(3+i*2)*(1+j*.06)])),samples:Object.fromEntries(projects.map(p=>[p.id,7])),suppliers:{'演示·综合食材':{avgPrice:5,minPrice:4,maxPrice:6,samples:7}}}));
const analytics={visibility:{unitPrice:true,amount:true},range:{from:daily[0].date,to:today},projects,priceMatrix:matrix,products:[],dimensions:[],supplierSpend:[],projectSpend:[]};
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});const errors=[],results=[];
try{for(const width of [375,390,430,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-CN'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let saved,historyUrl='',analyticsQueries=0;
  const current=structuredClone(business);
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    if(p==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:js});
    if(p==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
    if(p==='/api/business/review'){
      const input=route.request().postDataJSON(),r=current.revenues.find(r=>r.id===input.id);assert.equal(r.version,input.version);assert.equal(r.status,'PENDING_REVIEW');r.status=input.action==='approve'?'APPROVED':'NEEDS_REVISION';r.reviewNote=input.note;r.version++;return json({version:r.version,status:r.status});
    }
    if(p==='/api/business'){
      if(route.request().method()==='PATCH'){
        saved=route.request().postDataJSON();const r=current.revenues.find(r=>r.projectId===saved.projectId&&r.date===saved.date);assert.equal(r.version,saved.version);Object.assign(r,saved,{status:'PENDING_REVIEW',reviewNote:'',version:r.version+1});return json({version:r.version,status:r.status});
      }
      const projectId=url.searchParams.get('projectId')||'',from=url.searchParams.get('from')||current.from,to=url.searchParams.get('to')||current.to;
      const rows=current.revenues.filter(r=>(!projectId||r.projectId===projectId)&&r.date>=from&&r.date<=to);
      const result={...current,projectId,from,to,revenues:rows,revenueReview:{pendingCount:rows.filter(r=>r.status==='PENDING_REVIEW').length,returnedCount:rows.filter(r=>r.status==='NEEDS_REVISION').length},projectCards:current.projectCards.filter(p=>!projectId||p.id===projectId)};
      result.summary={...current.summary,revenue:rows.filter(r=>r.status==='APPROVED').reduce((s,r)=>s+r.amount,0)};
      return json(result);
    }
    if(p==='/api/analytics'){analyticsQueries++;return json({...analytics,priceMatrix:analyticsQueries>1?matrix.slice(0,1):matrix});}
    if(p==='/api/bootstrap')return json({user:{globalRole:'ADMIN'}});
    if(p.endsWith('/history')){historyUrl=url.href;return json({total:0,items:[]});}
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'});
  });
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const alignedDates=async()=>{
    const inputs=page.getByRole('form',{name:'经营日期筛选'}).locator('input[type=date]');const a=await inputs.nth(0).boundingBox(),b=await inputs.nth(1).boundingBox();assert(Math.abs(a.y-b.y)<1);assert(Math.abs(a.height-b.height)<1);assert(a.height>=44);
  };
  await page.goto('https://business-ui.invalid/business');await page.locator('.business-project-card').first().waitFor();assert.equal(await page.locator('.business-project-card').count(),5);await noOverflow();await alignedDates();await page.screenshot({path:path.join(out,`project-cards-${width}.png`),fullPage:true});
  await page.locator('.business-project-card').first().click();await page.getByRole('heading',{name:projects[0].name,exact:true}).waitFor();await noOverflow();await alignedDates();assert.equal(await page.locator('.revenue-record').count(),1);assert.equal(await page.locator('.business-page').getByText(projects[1].name,{exact:true}).count(),0);
  await page.screenshot({path:path.join(out,`business-${width}.png`),fullPage:true});
  await page.locator('.category-list button').first().click();assert((await page.locator('.category-list .business-tooltip').innerText()).includes('31.75%'));
  await page.getByRole('button',{name:'审核通过',exact:true}).click();await page.getByRole('button',{name:'确认通过',exact:true}).click();await page.locator('.revenue-status').filter({hasText:'已通过'}).waitFor();
  await page.getByLabel('开始日期',{exact:true}).fill('2026-01-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-01-02');await page.getByRole('button',{name:'查询',exact:true}).click();await page.getByText('暂无营业额，使用上方按钮录入',{exact:true}).waitFor();
  await page.getByRole('button',{name:'录入今日营业额',exact:true}).click();await page.getByLabel('当日总营业额（元）').waitFor();await page.waitForFunction(()=>document.querySelector('.revenue-form input[type=number]')?.value==='12000');await page.getByLabel('当日总营业额（元）').fill('12345.67');await page.getByRole('button',{name:'保存并提交审核',exact:true}).click();await page.getByText('营业额已提交审核',{exact:true}).waitFor();assert.equal(saved.amount,12345.67);assert.equal(saved.version,2);assert.equal(saved.projectId,'p0');
  await page.getByLabel('开始日期',{exact:true}).fill(current.from);await page.getByLabel('结束日期',{exact:true}).fill(today);await page.getByRole('button',{name:'查询',exact:true}).click();await page.locator('.revenue-status').filter({hasText:'待审核'}).waitFor();
  await page.getByRole('button',{name:'退回',exact:true}).click();await page.getByLabel('审核意见（必填）').fill('请核对日报');await page.getByRole('button',{name:'确认退回',exact:true}).click();await page.locator('.revenue-status').filter({hasText:'已退回'}).waitFor();await page.getByText('审核意见：请核对日报',{exact:true}).waitFor();
  await page.getByRole('button',{name:'修改',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.revenue-form input[type=number]')?.value==='12345.67');await page.getByRole('button',{name:'保存并提交审核',exact:true}).click();await page.locator('.revenue-status').filter({hasText:'待审核'}).waitFor();
  await page.getByRole('button',{name:'← 返回项目列表',exact:true}).click();await page.locator('.business-project-card').nth(1).click();await page.getByRole('heading',{name:projects[1].name,exact:true}).waitFor();assert.equal(await page.locator('.revenue-record').count(),1);assert((await page.locator('.revenue-record').innerText()).includes('12,100'));
  await page.goto('https://business-ui.invalid/analytics');await page.locator('.heatmap').waitFor();await noOverflow();await page.screenshot({path:path.join(out,`heatmap-${width}.png`),fullPage:true});await page.locator('.heatmap tbody tr').first().locator('.matrix-value').nth(1).click();await page.getByText(/7条样本；下方采购历史已限定该项目/).waitFor();assert.equal(new URL(historyUrl).searchParams.get('projectId'),'p1');
  await page.locator('.heatmap tbody tr').first().locator('.matrix-label').click();await page.waitForFunction(()=>document.querySelector('.material-insight h2')?.textContent?.includes('全部授权项目'));await page.waitForTimeout(50);assert.equal(new URL(historyUrl).searchParams.get('projectId'),'');
  await page.getByRole('button',{name:'下一页',exact:true}).first().click();assert((await page.locator('.pager').first().innerText()).includes('第2页'));await page.getByRole('button',{name:'查询',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pager')?.textContent?.includes('1组材料'));assert((await page.locator('.pager').first().innerText()).includes('第1页'));assert.equal(await page.locator('.heatmap tbody tr').count(),1);
  results.push({width,cards:'PASS',projectIsolation:'PASS',dates:'PASS',approvalReturnResubmit:'PASS',lookupOutsideFilters:'PASS',heatmap:'PASS',paginationReset:'PASS'});await context.close();
}assert.deepEqual(errors,[]);await writeFile(path.join(out,'ui-result.json'),JSON.stringify({mode:'MOCKED_API_ACTUAL_COMPONENTS',results,errors},null,2));console.log(JSON.stringify({results,errors}));}finally{await browser.close();}
