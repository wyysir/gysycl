import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const child=spawn(process.execPath,['--require','./scripts/preload.cjs','./node_modules/next/dist/bin/next','start','-p','3107','-H','127.0.0.1'],{cwd:path.join(root,'.tmp/catalog-browser'),windowsHide:true,stdio:'inherit',env:{...process.env,APP_URL:'http://localhost:3107',DEMO_MODE:'true',OCR_MODE:'mock',DATABASE_URL:'',REDIS_URL:'',STORAGE_DRIVER:'local',SESSION_SECRET:'isolated-catalog-20261029-local-test-only'}});
process.on('SIGINT',()=>child.kill());child.on('exit',code=>{process.exitCode=code??1;});
