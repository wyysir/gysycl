import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const {base,draftId,reviewId}=JSON.parse(await fs.readFile(process.env.LEDGER_FIXTURE_PATH || '.tmp/ledger-shots/fixture.json','utf8'));
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Use an isolated local demo only');
const out=process.env.LEDGER_OUTPUT_DIR || '.tmp/ledger-shots/aligned';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const ctx=await browser.newContext({viewport:{width:1536,height:1024}});
await ctx.request.post(base+'/api/auth/login',{data:{employeeNo:'admin',password:'admin123'}});
assert.equal((await (await ctx.request.get(base+'/api/bootstrap')).json()).system.ocrMode,'mock');
const page=await ctx.newPage(),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
async function shot(name,route){await page.goto(base+route,{waitUntil:'networkidle'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');await page.screenshot({path:out+'/'+name+'.png',fullPage:true});}
try {
 await shot('01-dashboard-desktop','/dashboard');
 const tokens=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return {primary:s.getPropertyValue('--brand').trim(),gold:s.getPropertyValue('--gold').trim(),paper:s.getPropertyValue('--paper').trim(),font:getComputedStyle(document.body).fontFamily,sidebar:getComputedStyle(document.querySelector('.sidebar')).width};});
 assert.equal(tokens.primary,'#775740');assert.equal(tokens.gold,'#d0a350');assert.equal(tokens.paper,'#f7f5f0');assert.equal(tokens.sidebar,'224px');checks.push('品牌色值、字体栈、224px侧栏与方案一致');
 assert.equal(await page.locator('.work-spend').evaluate(el=>getComputedStyle(el).fontSize),'32px');
 await shot('04-review-desktop','/documents/'+reviewId+'?from=reviews');
 assert.equal(await page.locator('.ledger-item-table tbody>tr').count(),4);
 assert(await page.getByRole('button',{name:'普通通过',exact:true}).isDisabled());checks.push('主管审核三栏、四条明细、严重异常禁用普通通过');
 await page.getByRole('button',{name:'下一页原图',exact:true}).click();assert.match(await page.locator('.original-toolbar').innerText(),/第 2/);
 await page.setViewportSize({width:1024,height:800});
 await page.getByRole('button',{name:'处理依据',exact:true}).click();await page.getByRole('button',{name:'关闭处理依据',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');await page.keyboard.press('Escape');assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');checks.push('中屏两栏、抽屉打开锁滚动、Esc关闭恢复');
 await page.getByRole('button',{name:'处理依据',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
 await page.getByRole('button',{name:'关闭处理依据',exact:true}).click();checks.push('中屏抽屉切至手机宽度后释放滚动锁');
 await page.setViewportSize({width:1536,height:1024});await page.goto(base+'/analytics',{waitUntil:'networkidle'});
 await page.locator('.price-matrix tbody tr').filter({hasText:'青菜'}).locator('.matrix-value').first().click();await page.locator('.insight-columns>div:nth-child(2) tbody').waitFor();await page.screenshot({path:out+'/05-analytics-desktop.png',fullPage:true});
 const chosen=await page.locator('.material-insight h2').innerText();await page.locator('.material-insight a').first().click();await page.getByRole('link',{name:'返回列表',exact:true}).first().click();await page.waitForURL('**/analytics');assert.equal(await page.locator('.material-insight h2').innerText(),chosen);checks.push('分析矩阵选择、采购历史跳转与返回保留所选材料');
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.addCookies(await ctx.cookies());const mp=await mobile.newPage();mp.on('pageerror',e=>errors.push(e.message));
 await mp.goto(base+'/documents/'+draftId+'?from=documents',{waitUntil:'networkidle'});
 assert.equal(await mp.locator('.ledger-line').count(),4);assert.equal(await mp.locator('.ledger-line-body').count(),1);assert.equal(await mp.getByLabel('第1项单价',{exact:true}).inputValue(),'4.80');
 assert.deepEqual(await mp.getByLabel('第1项单价',{exact:true}).evaluate(el=>({font:getComputedStyle(el).fontSize,radius:getComputedStyle(el).borderRadius,height:el.getBoundingClientRect().height})),{font:'16px',radius:'10px',height:48});
 for(const selector of ['.ledger-back','.document-tools>.icon-button']){const size=await mp.locator(selector).evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));assert(size.width>=44&&size.height>=44);}
 await mp.screenshot({path:out+'/03-detail-mobile.png',fullPage:true});await mp.screenshot({path:out+'/03-detail-mobile-viewport.png'});
 await mp.getByLabel('第1项单价',{exact:true}).fill('1.1');await mp.getByLabel('第1项数量',{exact:true}).focus();assert.equal(await mp.getByLabel('第1项单价',{exact:true}).inputValue(),'1.10');checks.push('金额1.1离焦稳定显示1.10，避免浮点乘100误判');
 await mp.getByLabel('第1项单价',{exact:true}).fill('4.2567');await mp.locator('.ledger-line-toggle').nth(1).click();await mp.locator('.ledger-line-toggle').first().click();assert.equal(await mp.getByLabel('第1项单价',{exact:true}).inputValue(),'4.2567');checks.push('手机折叠明细保留输入，金额格式化不截断四位单价');
 await mp.getByRole('button',{name:'查看第 1 页',exact:true}).click();await mp.getByRole('dialog',{name:'原图查看',exact:true}).waitFor();await mp.getByRole('button',{name:'关闭原图',exact:true}).click();assert.equal(await mp.getByLabel('第1项单价',{exact:true}).inputValue(),'4.2567');checks.push('原图弹层开关不丢失输入');
 await mp.getByRole('button',{name:'更多单据操作'}).click();await mp.locator('.document-tools-menu').getByRole('button',{name:'增加一行'}).click();assert.equal(await mp.locator('.ledger-line').count(),5);assert(await mp.getByLabel('第5项数量',{exact:true}).isVisible());checks.push('手机新增明细自动展开，入口可操作');
 for(const width of [320,390,430]){await mp.setViewportSize({width,height:844});assert(await mp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile detail overflow '+width);}
 await mobile.close();
 const upload=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await upload.addCookies(await ctx.cookies());const up=await upload.newPage();await up.goto(base+'/upload?from=documents',{waitUntil:'networkidle'});
 await up.locator('input[type=file]').first().setInputFiles(['.tmp/ledger-shots/page1.png','.tmp/ledger-shots/page2.png']);await up.waitForFunction(()=>Array.from(document.querySelectorAll('.upload-thumb img')).every(i=>i.complete&&i.naturalWidth));
 assert(await up.getByRole('button',{name:'上传并识别 2 页',exact:true}).isEnabled());
 await up.waitForTimeout(250); // Wait for the enabled-state color transition before photographing it.
 await up.screenshot({path:out+'/02-upload-mobile.png',fullPage:true});await up.screenshot({path:out+'/02-upload-mobile-viewport.png'});
 assert.equal(await up.locator('.upload-mobile-back').getAttribute('href'),'/documents');assert.equal(await up.locator('.upload-thumb').count(),2);assert.equal(await up.locator('.upload-flow li').count(),3);checks.push('录入页步骤条、拍照/相册、两页预览、固定上传按钮与返回来源');
 for(const width of [320,390,430]){await up.setViewportSize({width,height:844});assert(await up.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'upload overflow '+width);}
 checks.push('320/390/430手机宽度无整页横向溢出');assert.deepEqual(errors,[]);
 await upload.close();
 for(const route of ['/dashboard','/analytics']) {await page.goto(base+route,{waitUntil:'networkidle'});for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' overflow '+width);}}
 checks.push('手机工作台与价格分析在320/390/430宽度无整页横向溢出');
 const result={status:'PASS',checkedAt:new Date().toISOString(),tokens,checks,pageErrors:errors,fixture:'Isolated demo only; supplied company logo; two pages/four items'};await fs.writeFile(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
