// Optional local real-photo fixture verification; fixture images/results stay outside Git.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import sharp from 'sharp';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const output=path.resolve('.data/batch-compression-20261104');await mkdir(output,{recursive:true});
const code=(await build({stdin:{contents:'export {compressBatchImage} from "./src/lib/client/batches";',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'batchCompression'})).outputFiles[0].text;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:code});const results=[];
 for(const id of ['S01','S10']){
  // Lossless PNG wrapper triggers >1.2 MiB without inventing extra image detail.
  const input=await sharp('.data/ocr-eval-20261031/'+id+'.jpg').png().toBuffer();await writeFile(path.join(output,id+'.png'),input);
  const r=await page.evaluate(async({encoded,id})=>{const bytes=Uint8Array.from(atob(encoded),x=>x.charCodeAt(0)),input=new File([bytes],id+'.png',{type:'image/png'});const out=await batchCompression.compressBatchImage(input);const b=await out.arrayBuffer();const base64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(out);});const bitmap=await createImageBitmap(out);return {name:out.name,mime:out.type,bytes:b.byteLength,width:bitmap.width,height:bitmap.height,base64};},{encoded:input.toString('base64'),id});
  assert.equal(r.mime,'image/jpeg');assert.ok(r.bytes<input.length);assert.ok(Math.max(r.width,r.height)<=3000);await writeFile(path.join(output,id+'.compressed.jpg'),Buffer.from(r.base64,'base64'));
  results.push({id,inputFormat:'lossless PNG of existing photo',inputBytes:input.length,outputBytes:r.bytes,width:r.width,height:r.height,savedPercent:Number((100*(1-r.bytes/input.length)).toFixed(2))});
 }
 const large=await sharp({create:{width:4032,height:3024,channels:3,background:'#ffffff'}}).composite([{input:await sharp('.data/ocr-eval-20261031/S01.jpg').resize(3000).png().toBuffer(),left:0,top:0}]).png().toBuffer();
 const dimensions=await page.evaluate(async encoded=>{const file=new File([Uint8Array.from(atob(encoded),x=>x.charCodeAt(0))],'large.png',{type:'image/png'});const output=await batchCompression.compressBatchImage(file);const image=await createImageBitmap(output);return {width:image.width,height:image.height,smaller:output.size<file.size};},large.toString('base64'));assert.equal(dimensions.width,3000);assert.ok(dimensions.smaller);
 const fallback=await page.evaluate(async()=>{const bytes=new Uint8Array([137,80,78,71]);const small=new File([bytes],'small.png',{type:'image/png'});return await batchCompression.compressBatchImage(small)===small;});assert.equal(fallback,true);
 const report={status:'PASS',maxEdge:3000,jpegQuality:.91,triggerBytes:1.2*1024*1024,neverUpscale:true,useOnlyWhenSmaller:true,smallFilePassThrough:true,results,largeImage:dimensions,limit:'Rewrapped existing pictures exercise compression; they are not new phone-camera originals. OCR comparison is a separate server test.'};await writeFile(path.join(output,'compression-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
