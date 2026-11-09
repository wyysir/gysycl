// Serves only this isolated proposal directory. No backend, credentials or uploads.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const allowed=new Set(['demo.html','demo.css','demo.js']);
http.createServer(async(req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname.slice(1)||'demo.html';
 if(req.method!=='GET'||!allowed.has(file)){res.writeHead(404);res.end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(await readFile(path.join(root,file)));}
 catch{res.writeHead(404);res.end();}
}).listen(4326,'127.0.0.1',()=>console.log('Proposal only: http://127.0.0.1:4326/demo.html'));
