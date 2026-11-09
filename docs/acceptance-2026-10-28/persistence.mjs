import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
const base='http://localhost:3107',out=new URL('./',import.meta.url);
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({employeeNo:'admin',password:'admin123'})});
assert.equal(login.status,200);const cookie=login.headers.getSetCookie()[0].split(';')[0];
async function get(path){const r=await fetch(base+path,{headers:{Cookie:cookie}});assert.equal(r.status,200,path);return r.json();}
const documents=(await get('/api/documents?limit=200')).documents;
const details=[];
for(const document of documents){const detail=await get('/api/documents/'+document.id);assert.notEqual(detail.document.status,'PROCESSING','Wait for OCR before snapshot');details.push(detail);}
details.sort((a,b)=>a.document.id.localeCompare(b.document.id));
const imageHashes=[];
for(const detail of details){for(const page of detail.document.pages){const r=await fetch(base+page.url,{headers:{Cookie:cookie}});assert.equal(r.status,200);await r.arrayBuffer();}}
const uploads=path.resolve(import.meta.dirname,'../../.tmp/acceptance-2026-10-28/.data/uploads');
for(const key of await fs.readdir(uploads,{recursive:true})){const file=path.join(uploads,key);if(!(await fs.stat(file)).isFile())continue;imageHashes.push({key,sha256:crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')});}
imageHashes.sort((a,b)=>a.key.localeCompare(b.key));
const snapshot={details,imageHashes,dashboard:await get('/api/dashboard'),bootstrap:await get('/api/bootstrap')};
const file=new URL('persistence-snapshot.json',out);
if(process.argv[2]==='capture'){await fs.writeFile(file,JSON.stringify(snapshot,null,2));console.log(JSON.stringify({captured:true,documents:details.length,images:imageHashes.length}));}
else{assert.deepEqual(snapshot,JSON.parse(await fs.readFile(file,'utf8')));const result={status:'PASS',documents:details.length,images:imageHashes.length,scope:'restart retains all document fields, items, checks, approvals, audit, masters, dashboard and original image hashes'};await fs.writeFile(new URL('persistence-results.json',out),JSON.stringify(result,null,2));console.log(result);}
