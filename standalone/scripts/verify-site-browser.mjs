// Opens a served standalone build in Chromium and checks what verify-site.mjs cannot: each app
// starts with browser storage, exports a backup, restores a changed backup through the UI, keeps
// the change after a reload, and hides local-only full-stack links on a public host.
// Usage: node scripts/verify-site-browser.mjs <url>
// CHROMIUM_PATH selects a browser binary; CHROMIUM_ARGS is a JSON array of extra launch flags.
import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPS } from './verify-site.mjs';

const target = process.argv[2];
if (!target) { console.error('Usage: node scripts/verify-site-browser.mjs <url>'); process.exit(2); }
const base = new URL(target.endsWith('/') ? target : `${target}/`);
const local = ['localhost', '127.0.0.1'].includes(base.hostname);
const failures = [], rows = [];
const fail = (app, message) => failures.push(`${app}: ${message}`);
const folder = await mkdtemp(join(tmpdir(), 'geolab-site-check-'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: JSON.parse(process.env.CHROMIUM_ARGS || '[]') });

// Changes the first name or title in the first record collection, keeping record shapes valid.
function mark(state, marker) {
  for (const [key, value] of Object.entries(state)) {
    if (!Array.isArray(value) || !value.length) continue;
    const field = ['name', 'title'].find(name => typeof value[0]?.[name] === 'string');
    if (field) { value[0][field] = marker; return `${key}[0].${field}`; }
  }
  return null;
}
const storedText = (page, app) => page.evaluate(id => new Promise((resolve, reject) => {
  const opening = indexedDB.open(`geolab-standalone-${id}-v1`);
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const store = opening.result.transaction('data').objectStore('data');
    const values = store.getAll(), meta = store.get('meta');
    values.onsuccess = () => { meta.onsuccess = () => resolve({ text: JSON.stringify(values.result), revision: meta.result?._revision || 0 }); };
  };
}), app);
const saved = page => page.getByText('Saved in this browser (IndexedDB)').waitFor({ timeout: 90000 });
// Records what a page actually showed, so a failure on a remote host can be diagnosed from the log.
function watch(page) {
  const notes = [];
  page.on('console', message => { if (message.type() === 'error' && notes.length < 6) notes.push(`console: ${message.text().slice(0, 200)}`); });
  page.on('requestfailed', request => { if (notes.length < 6) notes.push(`request failed: ${request.url().slice(0, 120)} (${request.failure()?.errorText})`); });
  page.on('response', response => { if (response.status() >= 400 && notes.length < 6) notes.push(`HTTP ${response.status()}: ${response.url().slice(0, 120)}`); });
  return async () => {
    const title = await page.title().catch(() => '');
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    return `at ${page.url()} title "${title}" text "${text}"${notes.length ? `; ${notes.join('; ')}` : ''}`;
  };
}

try {
  {
    const page = await browser.newPage();
    const describe = watch(page);
    try {
      const response = await page.goto(base.href);
      const originals = await page.locator('[data-port]').count();
      const hostedTip = await page.locator('[data-hosted]').count();
      if (!local && (originals || !hostedTip)) fail('gallery', `public host shows ${originals} local full-stack links and ${hostedTip} hosted notes (HTTP ${response?.status()}) ${await describe()}`);
      rows.push(['gallery', 'opened', local ? 'local host variant' : `hosted variant (${originals} local links)`, '—']);
    } catch (error) {
      fail('gallery', `${error.message.split('\n')[0]} ${await describe()}`);
    } finally {
      await page.close();
    }
  }
  for (const app of APPS) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const describe = watch(page);
    try {
      await page.goto(new URL(`${app}/`, base).href);
      await saved(page);
      const fullStackLinks = await page.getByRole('link', { name: 'Open full-stack version' }).count();
      if (!local && fullStackLinks) fail(app, 'public host shows the local full-stack link');

      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export local backup' }).click()]);
      const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
      if (backup.app !== app || backup.format !== 'geospatial-web-lab-standalone-backup') { fail(app, 'downloaded backup has the wrong app or format'); continue; }

      const marker = `Live site check ${Date.now()}`;
      const field = mark(backup.state, marker);
      if (!field) { fail(app, 'no record with a name or title to change'); continue; }
      const file = join(folder, `${app}.json`);
      await writeFile(file, JSON.stringify(backup));
      const before = (await storedText(page, app)).revision;
      await page.getByLabel('Backup file').setInputFiles(file);
      await page.getByRole('alertdialog', { name: 'Restore standalone backup' }).waitFor();
      await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Restore backup' }).click()]);
      await saved(page);
      await page.reload();
      await saved(page);
      const after = await storedText(page, app);
      if (!after.text.includes(marker)) fail(app, `restored ${field} was not kept after a reload`);
      if (after.revision <= before) fail(app, `stored revision did not advance (${before} -> ${after.revision})`);
      const shown = await page.getByText(marker).first().isVisible().catch(() => false);
      const canvases = await page.locator('canvas').count();
      // Uncaught errors fail the check, except WebGL availability, which depends on the runner.
      const unexpected = errors.filter(message => !/webgl/i.test(message));
      if (unexpected.length) fail(app, `uncaught page errors: ${unexpected.join(' | ').slice(0, 300)}`);
      rows.push([app, 'saved, exported, restored, reloaded', `${field} kept${shown ? ' and shown' : ''}; revision ${before} -> ${after.revision}`, `${canvases} canvas${canvases === 1 ? '' : 'es'}`]);
    } catch (error) {
      fail(app, `${error.message.split('\n')[0]} ${await describe()}${errors.length ? `; page errors: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await rm(folder, { recursive: true, force: true });
}

const table = ['### Browser check of ' + base.href, '', '| App | Workflow | Result | Map or scene canvases |', '| --- | --- | --- | --- |', ...rows.map(row => `| ${row.join(' | ')} |`), ''].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n');
for (const failure of failures) console.error(`FAIL ${failure}`);
if (failures.length) process.exitCode = 1;
else console.log('Gallery and all five apps passed the browser check.');
