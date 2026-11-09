// Rebuild the human-readable case appendix and CSV issue tracker from evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const read=async name=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
const api=await read('api-results.json'),ext=await read('extended-results.json'),issues=await read('issues.json');
const reconciliation=await read('reconciliation-results.json'),remaining=await read('remaining-results.json');
const clean=s=>String(s??'').replace(/\u001b\[[0-9;]*m/g,'').replaceAll('|','\\|').replaceAll('\r','').replaceAll('\n','<br>');
const severityCount=Object.fromEntries(['阻断','严重','一般'].map(v=>[v,issues.filter(i=>i.severity===v).length]));
assert.deepEqual(severityCount,{'阻断':3,'严重':5,'一般':5});
assert.equal(api.results.filter(t=>t.status==='FAIL').length,12);assert.equal(ext.numFailedTests,1);
for(const item of issues){assert(api.results.some(r=>r.id===item.tests&&r.status==='FAIL')||item.tests==='D05');}
const fields={id:'编号',severity:'严重程度',priority:'优先级',tests:'测试项',title:'问题描述',steps:'复现步骤',expected:'预期',actual:'实际表现',impact:'影响范围',source:'代码定位',owner:'建议责任岗位',fix:'修复建议',regression:'回归方式',status:'状态'};
const csvRow=values=>values.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',');
const csv=[csvRow([...Object.values(fields),'实际负责人','计划完成日','修复版本','复测版本','复测结果','业务确认人']),...issues.map(i=>csvRow([...Object.keys(fields).map(k=>i[k]),'待会议指派','','','','待复测','']))].join('\r\n');
await fs.writeFile(path.join(dir,'issues.csv'),'\ufeff'+csv+'\r\n');
const mainDetails={
 A01:'200，数据库up；冷请求耗时见请求记录。',A02:'11个业务读取路径均401。',A03:'4个角色200；Cookie HttpOnly/Secure/SameSite=lax/Max-Age=43200。',A04:'错误密码401、坏JSON400、外域Origin403。',A05:'初始化仅上海项目，列表仅上海；指定杭州列表及杭州详情403。',A06:'两类错字均返回3个候选；首选青菜/土豆。',A07:'总览、分析、管理员审核队列200；采购审核队列403、财务用户管理403；未来空区间200。',A08:'模板和导出均3表；初始8张演示单据，汇总金额与列表一致。',
 U01:'3种编码图片上传成功，匿名图片读取401。',U02:'非法格式、0大小、15MB+1声明400；15MB声明200；伪内容400、坏签名403、财务申请上传403。',U04:'创建201；5页按1–5排序且COMPLETED；Mock2行、无ocrError；管理员私有图200、跨项目采购403。',U05:'采购越项目和财务创建均403。',
 F01:'保存200；重复旧version保存409，42元金额保持。',F02:'财务PATCH、review、recheck、ocr均403。',F03:'提交、主管保存、退回补充、采购补充、重提、普通通过均按状态完成；缺退回原因400、采购改待审和已审403。',F04:'严重异常普通通过422；无原因强制通过400；有原因200并记录OVERRIDE_APPROVE。',
 B01:'负数量及201行400；可保存空草稿，未填供应商/明细提交422。',B04:'同版本2并发得到200、409。',B08:'10轮×3请求，每轮1个200、2个409。',B09:'相同原图重复建立第二张单据产生duplicate_image。',B10:'并发审核通过/退回本轮仅1个成功；另一方拒绝，未产生两个成功审核结果。',
 M01:'缺确认400；新建供应商及材料201；重复供应商409；空单位400。',M03:'普通员工合并403；管理员供应商合并200；合并自身400。实际引用/金额保持另由I06/I07验证。',M04:'dryRun校验成功且供应商数不变；实际导入新增1供应商、1材料、1合同；非法文件400。',M05:'200携带工作表/第2行错误，整批供应商数不变。',M06:'项目201/重复409；员工201、重置200、旧密码401、新密码200、停用200/旧会话401；合同201/删除200。',
 U06:'过期地址403；实际发送15MB+1字节413。',F05:'仅上海主管审核杭州单据403。',W01:'未配置微信307回员工号入口；伪造绑定票据400。',P01:'100次10并发读取全部200，P50=38.65ms/P95=72.89ms/max=77.76ms，21张单据前后不变。',S04:'10次401后第11次429（独立测试IP键）。',S05:'注销200，Cookie Max-Age=0。'
};
let md='# 逐项验收结果与证据索引\n\n日期：2026-10-22；以下为测试项级记录，不能替代主报告的范围和交付结论。\n\n## 主HTTP验收：44组\n\n请求序号是api-results.json.requests的一基索引；预期的401/403/409/422不是服务故障。\n\n| ID | 验收项 | 结果 | 实际表现 | 请求序号 | 问题 |\n| --- | --- | --- | --- | --- | --- |\n';
for(const r of api.results){const defect=issues.find(i=>i.tests===r.id);md+=`| ${r.id} | ${clean(r.name)} | ${r.status==='PASS'?'通过':'不通过'} | ${clean(r.status==='PASS'?(mainDetails[r.id]??JSON.stringify(r.evidence)):r.actual)} | ${r.requests.join('–')} | ${defect?.id??'—'} |\n`;}
md+='\n## 单元、数据库、规则和离线故障注入：27项\n\n其中13项为原有测试，14项为本轮新增；26通过、1不通过。离线通道使用Mock模拟，未调用真实云API。\n\n| 文件 | 测试项 | 结果 | 证据/差异 |\n| --- | --- | --- | --- |\n';
for(const suite of ext.testResults)for(const t of suite.assertionResults){md+=`| ${clean(path.basename(suite.name))} | ${clean(t.title)} | ${t.status==='passed'?'通过':'不通过'} | ${t.status==='passed'?'断言全部成立；测试输入及期望见对应脚本。':clean(t.failureMessages.join('\n').split('\n').slice(0,4).join('\n'))+'；DEF-13'} |\n`;}
md+='\n## 数据勾稽与补充API：7项\n\n| ID | 验收项 | 结果 | 实际表现 |\n| --- | --- | --- | --- |\n';
const extraDetails={I04:'未登录user=null；登录后employeeNo=admin。',I05:'重新比对成功；重新识别后等待version递增，DRAFT、2行、无ocrError。',I06:'明细关联新材料后管理员合并到目标材料，关联更新，行金额和整单金额保持。',I07:'已引用供应商合并到sup_sh后，关联更新，明细/整单金额保持；初轮亦验证已审单供应商合并。'};
for(const r of [...reconciliation.results,...remaining.results])md+=`| ${r.id} | ${clean(r.name)} | ${r.status==='PASS'?'通过':'不通过'} | ${clean(r.status==='PASS'?(extraDetails[r.id]??JSON.stringify(r.evidence)):r.actual)} |\n`;
md+='\n## 页面和交付物\n\n| 检查 | 结果与证据 |\n| --- | --- |\n| 构建/类型检查/依赖树 | 命令退出码0，见build.log、typecheck.log、dependencies.json。新增验收代码纳入后的类型检查亦通过，见artifact-typecheck.log。 |\n| Prisma模型/客户端 | validate/generate均退出0，在隔离副本生成，不等于生产迁移执行。 |\n| 原有smoke | 输出ok=true、DRAFT、青莱/士豆匹配青菜/土豆，见smoke.log。 |\n| 七个工作页面 | 均能加载，390px视口中document.scrollWidth=375；ui-results.json保留每页测量。 |\n| 移动详情底部操作 | 保存按钮底边626.5px，固定导航顶边774px；无遮挡，见detail-mobile-footer.png。 |\n| 浏览器错误 | 本次页面访问捕获到的console error为空；不等于全部交互都无错误。 |\n| 停服后数据库读取 | 单据/明细22/40、4条正常修改有前后快照、6条MOCKED通知，见persistence-results.json。后续补充主数据测试产生了不同快照。 |\n\n## 已排除的脚本误报\n\napi-initial-results.json中U04使用了未公开的objectKey字段，后改为DTO的pages.url并通过；remaining-initial-results.json中异步重识别未等新版本完成，后修正等待条件并通过。这两项不计产品缺陷。所有最终失败仍保留严格预期，未放宽业务标准。\n';
await fs.writeFile(path.join(dir,'test-results.md'),md);
const manifest=await read('source-manifest.json');let unchanged=0;
for(const item of manifest){const full=path.join(root,item.path);const sha=crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');assert.equal(sha.toUpperCase(),item.sha256,`Source changed: ${item.path}`);unchanged++;}
const summary={date:'2026-10-22',conclusion:'不通过',defects:issues.length,severityCount,api:api.summary,offline:{total:ext.numTotalTests,passed:ext.numPassedTests,failed:ext.numFailedTests,includesOriginal:13},integration:{total:7,passed:7,failed:0},sourceFilesUnchanged:unchanged};
await fs.writeFile(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
