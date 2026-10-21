import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The container images serve the built apps through nginx with the Content-Security-Policy in
// scripts/nginx.conf; the other browser checks use the development servers, which send no policy.
// This check serves each app's production build (npm run build) with that policy, leaves the API
// and live updates to the development server's proxy, signs in, and waits for the map or 3D scene.
// It fails on anything the policy blocks, except ArcGIS's test of whether eval is allowed.
const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = readFileSync(join(root, 'scripts/nginx.conf'), 'utf8').match(/add_header Content-Security-Policy "([^"]+)" always;/)[1];
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.xml': 'application/xml'
};
// The data portal shows a map only for a dataset with accepted features, such as the seeded Parks Clean.
const apps = [
  ['01-service-requests', 5171], ['02-data-quality-portal', 5172, (page) => page.getByRole('button', { name: /^Parks Clean/ }).first().click()],
  ['03-fleet-monitor', 5173], ['04-parcel-scenarios', 5174], ['05-infrastructure-inspections', 5175]
];
const isFile = path => existsSync(path) && statSync(path).isFile();

// Chromium treats a page this check serves itself as coming from outside the local network, so
// its Local Network Access checks refuse the page's WebSocket to 127.0.0.1 before the policy is
// consulted. A page nginx serves is local, so the checks are turned off for this file only.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] } });

// Mirrors nginx.conf: files from the build, the page for unknown paths outside /assets/, the API,
// /up and /cable passed through.
async function serveBuild(context, dist, port) {
  await context.route(`http://127.0.0.1:${port}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (/^\/(api|cable|up)(\/|$)/.test(path)) return route.continue();
    let file = resolve(dist, `.${path}`);
    if (!file.startsWith(dist + sep) || !isFile(file)) {
      if (path.startsWith('/assets/')) return route.fulfill({ status: 404, body: 'Not found' });
      file = join(dist, 'index.html');
    }
    await route.fulfill({ status: 200, headers: { 'content-type': types[extname(file)] || 'application/octet-stream', 'content-security-policy': policy }, body: readFileSync(file) });
  });
}

// Collects every policy report from the context's pages.
async function recordPolicyReports(context) {
  const reports = [];
  await context.exposeBinding('reportPolicyViolation', (_source, report) => { reports.push(report); });
  await context.addInitScript(() => document.addEventListener('securitypolicyviolation', (event) => {
    globalThis.reportPolicyViolation({ effectiveDirective: event.effectiveDirective, blockedURI: event.blockedURI, sourceFile: event.sourceFile });
  }));
  return reports;
}

for (const [app, port, showMap] of apps) {
  test(`${app} loads its production build under the Content-Security-Policy`, async ({ browser }) => {
    test.setTimeout(120000);
    const dist = join(root, app, 'frontend', 'dist');
    expect(isFile(join(dist, 'index.html')), `${app} has no production build; run npm run build first`).toBe(true);
    const context = await browser.newContext();
    try {
      await serveBuild(context, dist, port);
      const reports = await recordPolicyReports(context);
      const page = await context.newPage();
      const errors = [];
      let subscribed = false;
      page.on('pageerror', (error) => errors.push(error.message));
      // Live updates use a WebSocket to this site, which connect-src 'self' must allow.
      page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { if (String(payload).includes('confirm_subscription')) subscribed = true; }));
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
      await page.getByLabel('Password', { exact: true }).fill('Learning123!');
      await page.getByRole('button', { name: 'Open workspace' }).click();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      await expect.poll(() => subscribed, { message: 'live updates did not subscribe' }).toBe(true);
      await showMap?.(page);
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60000 });
      // Tiles, map data and workers load after the first frame.
      await page.waitForTimeout(5000);
      await expect(page.locator('.map-error, .corridor-webgl-error')).toHaveCount(0);
      const blocked = reports.filter((report) => {
        const script = report.sourceFile?.startsWith(`http://127.0.0.1:${port}/`) ? resolve(dist, `.${new URL(report.sourceFile).pathname}`) : '';
        const arcgisEvalTest = report.effectiveDirective === 'script-src' && report.blockedURI === 'eval' && isFile(script) && readFileSync(script, 'utf8').includes('esri-csp-restrictions');
        return !arcgisEvalTest;
      }).map((report) => `${report.effectiveDirective} ${report.blockedURI || 'inline'} (${report.sourceFile || 'page'})`);
      expect(blocked, 'The Content-Security-Policy blocked these loads').toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
