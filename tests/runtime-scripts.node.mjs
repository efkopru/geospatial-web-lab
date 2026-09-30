import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function run(file, cwd) {
 return await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file], {cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({code, signal, output}));
 });
}

test('frontend supervisor preserves folder ports and stops siblings on failure', {timeout: 15000}, async () => {
 const fixture = await mkdtemp(join(tmpdir(), 'geolab runtime '));
 try {
  await mkdir(join(fixture, 'scripts'));
  await copyFile(join(root, 'scripts/dev-frontends.mjs'), join(fixture, 'scripts/dev-frontends.mjs'));
  await mkdir(join(fixture, 'node_modules/vite/bin'), {recursive: true});
  await writeFile(join(fixture, 'node_modules/vite/bin/vite.js'), `
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync('observed.json', JSON.stringify({pid: process.pid, port: process.argv[process.argv.indexOf('--port') + 1]}));
if (process.cwd().includes('05-infrastructure')) setTimeout(() => process.exit(7), 1000);
setInterval(() => {}, 1000);
`);
  for (const name of ['01-service-requests', '05-infrastructure-inspections']) await mkdir(join(fixture, name, 'frontend'), {recursive: true});
  // Launch outside the checkout to exercise root resolution, too.
  const result = await run(join(fixture, 'scripts/dev-frontends.mjs'), tmpdir());
  assert.equal(result.code, 7, result.output);
  for (const [name, port] of [['01-service-requests', '5171'], ['05-infrastructure-inspections', '5175']]) {
   const seen = JSON.parse(await readFile(join(fixture, name, 'frontend/observed.json'), 'utf8'));
   assert.equal(seen.port, port);
   assert.throws(() => process.kill(seen.pid, 0), 'frontend must not survive the failed supervisor');
  }
 } finally { await rm(fixture, {recursive: true, force: true}); }
});

test('environment generation replaces placeholders and preserves existing secrets', async () => {
 const fixture = await mkdtemp(join(tmpdir(), 'geolab environment '));
 try {
  await mkdir(join(fixture, 'scripts'));
  await copyFile(join(root, 'scripts/configure-env.mjs'), join(fixture, 'scripts/configure-env.mjs'));
  await mkdir(join(fixture, '01-service-requests'));
  await copyFile(join(root, '01-service-requests/.env.example'), join(fixture, '01-service-requests/.env.example'));
  assert.equal((await run(join(fixture, 'scripts/configure-env.mjs'), tmpdir())).code, 0);
  const first = await readFile(join(fixture, '01-service-requests/.env'), 'utf8');
  assert.doesNotMatch(first, /replace-with-/);
  assert.match(first, /SECRET_KEY_BASE=[a-f0-9]{128}/);
  assert.match(first, /POSTGRES_PASSWORD=[a-f0-9]{64}/);
  assert.match(first, /APP_DATABASE_PASSWORD=[a-f0-9]{64}/);
  assert.equal((await run(join(fixture, 'scripts/configure-env.mjs'), tmpdir())).code, 0);
  assert.equal(await readFile(join(fixture, '01-service-requests/.env'), 'utf8'), first);
 } finally { await rm(fixture, {recursive: true, force: true}); }
});
