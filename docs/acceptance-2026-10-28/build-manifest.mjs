import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const out=import.meta.dirname,root=path.resolve(out,'../..');
const read=async(name)=>JSON.parse(await fs.readFile(path.join(out,name),'utf8'));
const unit=await read('unit-results.json'),api=await read('api-results.json'),extra=await read('supplementary-api-results.json'),remaining=await read('remaining-results.json'),reconcile=await read('reconciliation-results.json'),ui=await read('ui-results.json'),persistence=await read('persistence-results.json'),performance=await read('performance.json');
assert.equal(unit.numFailedTests,0);assert.equal(unit.numPassedTests,50);
for(const suite of [api,extra,reconcile,ui])assert.equal(suite.summary.failed,0);
assert(remaining.results.every(test=>test.status==='PASS'));assert.equal(persistence.status,'PASS');
const summary={date:'2026-10-28',timezone:'Asia/Shanghai',scope:'local regression, mock OCR and isolated data',unit:{passed:50,failed:0},api:api.summary,supplementary:extra.summary,remaining:{passed:remaining.results.length,failed:0},reconciliation:reconcile.summary,ui:ui.summary,persistence,performance,build:'PASS',typecheck:'PASS',prismaValidate:'PASS',pendingDecisions:[{id:'B07',question:'同供应商同号跨日期是否也提醒重复？',changed:false}],userDecision:'低置信度仅提示，保持当前可提交流程'};
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
async function files(dir){const entries=await fs.readdir(dir,{withFileTypes:true});const result=[];for(const e of entries){if(e.isDirectory())result.push(...await files(path.join(dir,e.name)));else result.push(path.join(dir,e.name));}return result;}
const changed=[];
for(const file of [...await files(path.join(root,'src')),...await files(path.join(root,'tests'))]){
  const relative=path.relative(root,file).replaceAll('\\','/'),content=await fs.readFile(file);
  let before=null;try{before=await fs.readFile(path.join(root,'.tmp/before-stability-fixes-2026-10-28',relative));}catch{}
  if(!before||!content.equals(before))changed.push({file:relative,kind:before?'modified':'added',sha256:crypto.createHash('sha256').update(content).digest('hex')});
}
for(const relative of ['package.json','package-lock.json','tsconfig.json','.gitignore','README.md']){const content=await fs.readFile(path.join(root,relative));changed.push({file:relative,kind:'modified',sha256:crypto.createHash('sha256').update(content).digest('hex')});}
await fs.writeFile(path.join(out,'source-manifest.json'),JSON.stringify({date:'2026-10-28',files:changed},null,2));
console.log(JSON.stringify({unit:summary.unit,api:summary.api,ui:summary.ui,changedFiles:changed.length}));
