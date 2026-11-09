// Dedicated test data lives under .tmp; never use the project's .data directory.
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const root = path.resolve(import.meta.dirname, '../..');
const child = spawn(process.execPath, [
  '--require', './scripts/preload.cjs', './node_modules/next/dist/bin/next',
  'start', '-p', '3107', '-H', '127.0.0.1',
], {
  cwd: path.join(root, '.tmp/acceptance-2026-10-28'),
  env: { ...process.env, APP_URL: 'http://localhost:3107', DEMO_MODE: 'true',
    OCR_MODE: 'mock', DATABASE_URL: '', REDIS_URL: '', STORAGE_DRIVER: 'local',
    SESSION_SECRET: 'isolated-acceptance-2026-10-28-local-only' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const log=fs.createWriteStream(path.join(import.meta.dirname,'server.log'),{flags:'a'});
const errorLog=fs.createWriteStream(path.join(import.meta.dirname,'server-error.log'),{flags:'a'});
child.stdout.on('data',data=>{process.stdout.write(data);log.write(data);});
child.stderr.on('data',data=>{process.stderr.write(data);errorLog.write(data);});
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill());
