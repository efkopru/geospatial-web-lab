import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const dirs = fs.readdirSync(root).filter(name => /^0[1-5]-/.test(name)).sort();
const children = new Set();
let stopping = false;
function stop(code = 0) {
 if (stopping) return;
 stopping = true;
 process.exitCode = code;
 for (const child of children) child.kill('SIGTERM');
 // The process stays alive until children close, rather than abandoning them.
}
for (const dir of dirs) {
 const port = 5170 + Number(dir.slice(0, 2));
 const child = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {cwd: resolve(root, dir, 'frontend'), stdio: 'inherit', windowsHide: true});
 children.add(child);
 child.on('error', error => { console.error(`${dir}: ${error.message}`); children.delete(child); stop(1); });
 child.on('exit', (code, signal) => {
  children.delete(child);
  if (!stopping) {
   console.error(`${dir} exited (${signal ?? code}); stopping the remaining frontends.`);
   stop(code || 1);
  }
 });
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
