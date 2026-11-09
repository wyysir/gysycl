import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';

const base=process.env.CHECK_URL || 'http://localhost:3107';
const live=base==='https://42.121.106.105';
let account={employeeNo:'admin',password:'admin123'};
if(live){
  // Read the existing deployment account into memory; never log or save it.
  const remote="import json,pathlib; p=pathlib.Path('/opt/delivery-audit/admin.private.env'); a=dict(x.split('=',1) for x in p.read_text().splitlines() if '=' in x); print(json.dumps({'employeeNo':a['ADMIN_EMPLOYEE_NO'],'password':a['ADMIN_PASSWORD']}))";
  const command=`python3 -c "import base64;exec(base64.b64decode('${Buffer.from(remote).toString('base64')}'))"`;
  account=JSON.parse(execFileSync('C:/Windows/System32/OpenSSH/ssh.exe',['-i','C:/Users/Administrator/.ssh/gysycl_42_121_106_105','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=C:/Users/Administrator/.ssh/gysycl_known_hosts','root@42.121.106.105',command],{encoding:'utf8',timeout:30000}));
}
const browser=await chromium.launch({headless:true,channel:'msedge'});
const output=import.meta.dirname;
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(base+'/login',{waitUntil:'networkidle'});
  await page.getByLabel('员工号',{exact:true}).fill(account.employeeNo);
  await page.getByLabel('密码',{exact:true}).fill(account.password);
  await page.getByRole('button',{name:'登录系统',exact:true}).click();
  await page.waitForURL('**/dashboard');
  await page.goto(base+'/upload',{waitUntil:'networkidle'});
  const buffer=await sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
  const file=name=>({name,mimeType:'image/png',buffer});
  const [album]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'从相册选择',exact:true}).click()]);
  assert.equal(await album.element().getAttribute('capture'),null);
  assert.equal(album.isMultiple(),true);
  await album.setFiles([file('album-1.png'),file('album-2.png')]);
  await page.waitForFunction(()=>document.querySelectorAll('.upload-thumb').length===2);
  const [camera]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'拍照上传',exact:true}).click()]);
  assert.equal(await camera.element().getAttribute('capture'),'environment');
  assert.equal(camera.isMultiple(),false);
  await camera.setFiles(file('camera-1.png'));
  await page.waitForFunction(()=>document.querySelectorAll('.upload-thumb').length===3);
  const [secondAlbum]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'从相册选择',exact:true}).click()]);
  await secondAlbum.setFiles([file('album-3.png'),file('album-4.png'),file('album-5.png')]);
  await page.waitForFunction(()=>document.querySelectorAll('.upload-thumb').length===5);
  assert(await page.getByText('已忽略超出 5 页的图片',{exact:true}).isVisible());
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert(geometry.scroll<=geometry.width+1);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,live?'gallery-mobile-live.png':'gallery-mobile.png'),fullPage:true});
  const result={status:'PASS',base,albumHasNoCapture:true,albumSupportsMultiple:true,cameraCapture:'environment',cameraAndAlbumCanAppend:true,maxPages:5,mobileGeometry:geometry,pageErrors:errors};
  await fs.writeFile(path.join(output,live?'gallery-live-results.json':'gallery-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
